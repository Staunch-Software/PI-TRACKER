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
        rank=payload.rank,
        can_access_pi=payload.can_access_pi,
        can_access_pir=payload.can_access_pir,
        can_access_soa=payload.can_access_soa,
        can_access_landing=payload.can_access_landing,
        can_access_dd=payload.can_access_dd,
        can_access_vendor=payload.can_access_vendor,
        can_access_pd=payload.can_access_pd,
        can_access_pending_items=payload.can_access_pending_items,
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


@router.delete("/{user_id}", status_code=status.HTTP_200_OK)
def delete_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> dict:
    if current_user.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    from sqlalchemy import text

    # Check if user is the author of existing PI entries (non-nullable foreign key)
    pi_count = db.execute(
        text("SELECT COUNT(*) FROM pi_entries WHERE created_by = :uid"),
        {"uid": user_id},
    ).scalar() or 0

    if pi_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Cannot permanently delete '{user.full_name}' because they are the recorded author of "
                f"{pi_count} PI Tracker entries. Deactivate the user instead to revoke access while "
                f"preserving financial and audit integrity."
            ),
        )

    # Clean up safe nullable references and user-specific preferences
    db.execute(text("DELETE FROM table_layout_preferences WHERE user_id = :uid"), {"uid": user_id})
    db.execute(text("DELETE FROM audit_log_reads WHERE user_id = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vessels SET assigned_ta_id = NULL WHERE assigned_ta_id = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vessels SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE landing_reports SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE dd_tracker_entries SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE dd_tracker_entries SET updated_by = NULL WHERE updated_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE audit_log SET changed_by = NULL WHERE changed_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE pi_entries SET updated_by = NULL WHERE updated_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE pi_entries SET attached_by = NULL WHERE attached_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE invoice_attachments SET uploaded_by = NULL WHERE uploaded_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_bank_attachments SET uploaded_by = NULL WHERE uploaded_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET updated_by = NULL WHERE updated_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET bank_details_received_by = NULL WHERE bank_details_received_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET bank_details_updated_by = NULL WHERE bank_details_updated_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET bank_request_sent_by = NULL WHERE bank_request_sent_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_tracker_entries SET bank_verification_completed_by = NULL WHERE bank_verification_completed_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendor_detail_bulk_scrape_runs SET started_by = NULL WHERE started_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE vendors SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})
    db.execute(text("UPDATE owner_recipients SET created_by = NULL WHERE created_by = :uid"), {"uid": user_id})

    user_name = user.full_name
    user_email = user.email

    write_audit_log(
        db,
        entity_type=AuditEntityType.USER,
        entity_id=user.id,
        action=AuditAction.DELETE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} deleted user {user_name} ({user_email})",
    )

    db.delete(user)
    db.commit()

    return {"deleted": True, "id": str(user_id), "fullName": user_name, "email": user_email}

