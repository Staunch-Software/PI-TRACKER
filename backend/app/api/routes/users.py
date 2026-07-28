import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.core.security import hash_password
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserOut
from app.schemas.user_admin import UserCreateRequest, UserUpdateRequest
from app.services.audit import diff_fields, write_audit_log

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.ADMIN))
) -> list[User]:
    return db.query(User).order_by(User.full_name).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> User:
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{payload.email}' is already registered")

    user = User(
        email=payload.email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.USER,
        entity_id=user.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} created user {user.full_name} ({user.email}) as {user.role.value}",
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    updates = payload.model_dump(exclude_unset=True, exclude={"password"})
    if payload.password:
        user.password_hash = hash_password(payload.password)

    if updates:
        before = {field: getattr(user, field) for field in updates}
        for field, value in updates.items():
            setattr(user, field, value)

        changes = diff_fields(before, updates)
        if changes:
            write_audit_log(
                db,
                entity_type=AuditEntityType.USER,
                entity_id=user.id,
                action=AuditAction.UPDATE,
                changed_by=current_user.id,
                summary=f"{current_user.full_name} updated user {user.full_name} ({', '.join(changes.keys())})",
                changes=changes,
            )

    db.commit()
    db.refresh(user)
    return user
