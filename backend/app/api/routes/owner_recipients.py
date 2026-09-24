import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.owner_recipient import OwnerRecipient
from app.models.user import User
from app.schemas.owner_recipient import OwnerRecipientCreateRequest, OwnerRecipientOut, OwnerRecipientUpdateRequest
from app.services.audit import diff_fields, write_audit_log

router = APIRouter(prefix="/owner-recipients", tags=["owner-recipients"])


@router.get("", response_model=list[OwnerRecipientOut])
def list_owner_recipients(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    include_inactive: bool = Query(default=False),
) -> list[OwnerRecipient]:
    query = db.query(OwnerRecipient)
    if not include_inactive:
        query = query.filter(OwnerRecipient.is_active.is_(True))
    return query.order_by(OwnerRecipient.email).all()


@router.post("", response_model=OwnerRecipientOut, status_code=status.HTTP_201_CREATED)
def create_owner_recipient(
    payload: OwnerRecipientCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> OwnerRecipient:
    if db.query(OwnerRecipient).filter(OwnerRecipient.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{payload.email}' already exists")

    recipient = OwnerRecipient(name=payload.name, email=payload.email, created_by=current_user.id)
    db.add(recipient)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.OWNER_RECIPIENT,
        entity_id=recipient.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} added owner recipient {recipient.email}",
    )
    db.commit()
    db.refresh(recipient)
    return recipient


@router.patch("/{recipient_id}", response_model=OwnerRecipientOut)
def update_owner_recipient(
    recipient_id: uuid.UUID,
    payload: OwnerRecipientUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> OwnerRecipient:
    recipient = db.get(OwnerRecipient, recipient_id)
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Owner recipient not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("email") and updates["email"] != recipient.email:
        if db.query(OwnerRecipient).filter(OwnerRecipient.email == updates["email"], OwnerRecipient.id != recipient_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{updates['email']}' already exists")

    if updates:
        before = {field: getattr(recipient, field) for field in updates}
        for field, value in updates.items():
            setattr(recipient, field, value)

        changes = diff_fields(before, updates)
        if changes:
            write_audit_log(
                db,
                entity_type=AuditEntityType.OWNER_RECIPIENT,
                entity_id=recipient.id,
                action=AuditAction.UPDATE,
                changed_by=current_user.id,
                summary=f"{current_user.full_name} updated owner recipient {recipient.email} ({', '.join(changes.keys())})",
                changes=changes,
            )

    db.commit()
    db.refresh(recipient)
    return recipient
