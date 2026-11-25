from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import (
    CHANGE_PW_MAX_FAILURES,
    LOGIN_MAX_FAILURES_PER_ACCOUNT,
    LOGIN_MAX_FAILURES_PER_IP,
    LOGIN_WINDOW_SECONDS,
    auth_rate_limiter,
    get_client_ip,
)
from app.core.security import (
    SESSION_COOKIE_NAME,
    SESSION_MAX_AGE_SECONDS,
    create_session_token,
    hash_password,
    read_session_token,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User
from app.models.user_session import UserSession
from app.schemas.user import ChangePasswordRequest, LoginRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

_cookie_secure = settings.environment != "development"


def _issue_session(db: Session, response: Response, user: User) -> None:
    """Create a per-browser UserSession row and set the signed cookie (pruning stale rows)."""
    now = datetime.now(timezone.utc)
    db.query(UserSession).filter(
        UserSession.user_id == user.id,
        or_(UserSession.expires_at <= now, UserSession.revoked_at < now - timedelta(days=1)),
    ).delete(synchronize_session=False)

    session_row = UserSession(
        id=uuid.uuid4(),
        user_id=user.id,
        expires_at=now + timedelta(seconds=SESSION_MAX_AGE_SECONDS),
    )
    db.add(session_row)
    db.commit()

    token = create_session_token(str(user.id), user.token_version, str(session_row.id))
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure,
        max_age=SESSION_MAX_AGE_SECONDS,
        path="/",
    )


@router.post("/login", response_model=UserOut)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    client_ip = get_client_ip(request)
    acct_key = f"login:acct:{client_ip}:{payload.email.strip().lower()}"
    ip_key = f"login:ip:{client_ip}"
    auth_rate_limiter.check_or_raise(
        [
            (acct_key, LOGIN_MAX_FAILURES_PER_ACCOUNT, LOGIN_WINDOW_SECONDS),
            (ip_key, LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_SECONDS),
        ],
        detail="Too many failed login attempts. Please wait a few minutes and try again.",
    )

    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        auth_rate_limiter.record_failure([acct_key, ip_key], LOGIN_WINDOW_SECONDS)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    auth_rate_limiter.reset([acct_key])
    _issue_session(db, response, user)
    return user


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    pi_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict[str, bool]:
    if pi_session:
        parsed = read_session_token(pi_session)
        if parsed:
            user_id, _, session_id = parsed
            try:
                session_uuid = uuid.UUID(session_id)
            except ValueError:
                session_uuid = None
            if session_uuid:
                session_row = db.get(UserSession, session_uuid)
                if session_row and str(session_row.user_id) == user_id and session_row.revoked_at is None:
                    session_row.revoked_at = datetime.now(timezone.utc)
                    db.commit()
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, bool]:
    cp_key = f"cp:{current_user.id}:{get_client_ip(request)}"
    auth_rate_limiter.check_or_raise(
        [(cp_key, CHANGE_PW_MAX_FAILURES, LOGIN_WINDOW_SECONDS)],
        detail="Too many failed password attempts. Please wait a few minutes and try again.",
    )
    if not verify_password(payload.current_password, current_user.password_hash):
        auth_rate_limiter.record_failure([cp_key], LOGIN_WINDOW_SECONDS)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be at least 8 characters")

    auth_rate_limiter.reset([cp_key])
    now = datetime.now(timezone.utc)
    current_user.password_hash = hash_password(payload.new_password)
    current_user.token_version += 1
    db.query(UserSession).filter(
        UserSession.user_id == current_user.id,
        UserSession.revoked_at.is_(None),
    ).update({"revoked_at": now}, synchronize_session=False)
    _issue_session(db, response, current_user)
    return {"ok": True}
