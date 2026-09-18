from collections.abc import Callable

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.enums import UserRole
from app.core.security import SESSION_COOKIE_NAME, read_session_token
from app.db.session import get_db
from app.models.user import User


def get_current_user(
    db: Session = Depends(get_db),
    pi_session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User:
    if not pi_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = read_session_token(pi_session)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or invalid")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found or inactive")

    return user


def require_roles(*allowed_roles: UserRole) -> Callable[[User], User]:
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency


def require_module_access(module: str) -> Callable[[User], User]:
    """Gates a module's routes on the per-user can_access_pi/can_access_pir flags (independent
    of role) — ADMIN always passes regardless of the flags, same stance the frontend takes (see
    useRole.ts / TopNav.tsx), so an admin can never lock themselves out by unchecking their own
    boxes. module must be 'pi' or 'pir'."""
    flag_attr = {"pi": "can_access_pi", "pir": "can_access_pir"}[module]

    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role != UserRole.ADMIN and not getattr(current_user, flag_attr):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You don't have access to the {module.upper()} module",
            )
        return current_user

    return dependency
