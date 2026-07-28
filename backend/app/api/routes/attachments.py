import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.config import settings
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.invoice_attachment import InvoiceAttachment
from app.models.pi_entry import PiEntry
from app.models.user import User
from app.schemas.attachment import (
    AttachmentCompleteRequest,
    AttachmentInitRequest,
    AttachmentInitResponse,
    AttachmentOut,
)
from app.services.audit import write_audit_log
from app.services.blob_storage import build_blob_key, generate_download_sas_url, generate_upload_sas_url

router = APIRouter(prefix="/pi-entries", tags=["attachments"])

_SELECT_BY_ENTRY = """
    SELECT ia.id, ia.pi_entry_id, ia.blob_key, ia.file_name, ia.content_type, ia.size_bytes,
           ia.uploaded_by, u.full_name AS uploaded_by_name, ia.uploaded_at
    FROM invoice_attachments ia
    JOIN users u ON u.id = ia.uploaded_by
    WHERE ia.pi_entry_id = :pi_entry_id
    ORDER BY ia.uploaded_at DESC
"""

_SELECT_BY_ID = """
    SELECT ia.id, ia.pi_entry_id, ia.blob_key, ia.file_name, ia.content_type, ia.size_bytes,
           ia.uploaded_by, u.full_name AS uploaded_by_name, ia.uploaded_at
    FROM invoice_attachments ia
    JOIN users u ON u.id = ia.uploaded_by
    WHERE ia.id = :id
"""


@router.get("/{pi_entry_id}/attachments", response_model=list[AttachmentOut])
def list_attachments(
    pi_entry_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> list[dict]:
    rows = db.execute(text(_SELECT_BY_ENTRY), {"pi_entry_id": str(pi_entry_id)}).mappings().all()
    return [{**dict(row), "download_url": generate_download_sas_url(row["blob_key"])} for row in rows]


@router.post("/{pi_entry_id}/attachments/init", response_model=AttachmentInitResponse)
def init_attachment_upload(
    pi_entry_id: uuid.UUID,
    payload: AttachmentInitRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    entry = db.get(PiEntry, pi_entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI entry not found")

    blob_key = build_blob_key(pi_entry_id, payload.file_name)
    return {"blob_key": blob_key, "upload_url": generate_upload_sas_url(blob_key)}


@router.post("/{pi_entry_id}/attachments/complete", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
def complete_attachment_upload(
    pi_entry_id: uuid.UUID,
    payload: AttachmentCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    entry = db.get(PiEntry, pi_entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI entry not found")

    attachment = InvoiceAttachment(
        pi_entry_id=pi_entry_id,
        blob_container=settings.azure_storage_container,
        blob_key=payload.blob_key,
        file_name=payload.file_name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    db.flush()

    # Mirror the most recently attached file onto pi_entries for at-a-glance display.
    entry.invoice_file_name = payload.file_name
    entry.attached_by = current_user.id
    entry.date_attached = attachment.uploaded_at

    write_audit_log(
        db,
        entity_type=AuditEntityType.PI_ENTRY,
        entity_id=entry.id,
        action=AuditAction.ATTACH,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} attached {payload.file_name} to PI {entry.dpr_no}",
    )
    db.commit()

    row = db.execute(text(_SELECT_BY_ID), {"id": str(attachment.id)}).mappings().first()
    return {**dict(row), "download_url": generate_download_sas_url(row["blob_key"])}
