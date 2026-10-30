import uuid

from azure.core.exceptions import ResourceNotFoundError
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.config import settings
from app.core.enums import UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor_bank_attachment import VendorBankAttachment
from app.models.vendor_master_attachment import VendorMasterAttachment
from app.models.vendor_tracker_entry import VendorTrackerEntry
from app.schemas.vendor_attachment import (
    VendorBankAttachmentCompleteRequest,
    VendorBankAttachmentInitRequest,
    VendorBankAttachmentInitResponse,
    VendorBankAttachmentOut,
    VendorMasterAttachmentOut,
)
from app.services.blob_storage import delete_blob, generate_download_sas_url, generate_upload_sas_url


def _build_vendor_bank_blob_key(entry_id: uuid.UUID, file_name: str) -> str:
    safe_name = "".join(c for c in file_name if c.isalnum() or c in "._- ") or "file"
    return f"vendor-bank/{entry_id}/{uuid.uuid4()}-{safe_name}"

router = APIRouter(
    prefix="/vendor-management",
    tags=["vendor-attachments"],
    dependencies=[Depends(require_module_access("vendor"))],
)

_writers = require_roles(UserRole.ADMIN, UserRole.EDITOR)

_SELECT_BY_ENTRY = """
    SELECT vba.id, vba.vendor_tracker_entry_id, vba.blob_key, vba.file_name, vba.content_type,
           vba.size_bytes, vba.uploaded_by, u.full_name AS uploaded_by_name, vba.uploaded_at
    FROM vendor_bank_attachments vba
    JOIN users u ON u.id = vba.uploaded_by
    WHERE vba.vendor_tracker_entry_id = :entry_id
    ORDER BY vba.uploaded_at DESC
"""

_SELECT_BY_ID = """
    SELECT vba.id, vba.vendor_tracker_entry_id, vba.blob_key, vba.file_name, vba.content_type,
           vba.size_bytes, vba.uploaded_by, u.full_name AS uploaded_by_name, vba.uploaded_at
    FROM vendor_bank_attachments vba
    JOIN users u ON u.id = vba.uploaded_by
    WHERE vba.id = :id
"""


@router.get("/{entry_id}/attachments", response_model=list[VendorBankAttachmentOut])
def list_bank_attachments(entry_id: uuid.UUID, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(text(_SELECT_BY_ENTRY), {"entry_id": str(entry_id)}).mappings().all()
    return [{**dict(row), "download_url": generate_download_sas_url(row["blob_key"])} for row in rows]


@router.post("/{entry_id}/attachments/init", response_model=VendorBankAttachmentInitResponse)
def init_bank_attachment_upload(
    entry_id: uuid.UUID,
    payload: VendorBankAttachmentInitRequest,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> dict:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    blob_key = _build_vendor_bank_blob_key(entry_id, payload.file_name)
    return {"blob_key": blob_key, "upload_url": generate_upload_sas_url(blob_key)}


@router.post("/{entry_id}/attachments/complete", response_model=VendorBankAttachmentOut, status_code=status.HTTP_201_CREATED)
def complete_bank_attachment_upload(
    entry_id: uuid.UUID,
    payload: VendorBankAttachmentCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> dict:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    attachment = VendorBankAttachment(
        vendor_tracker_entry_id=entry_id,
        blob_container=settings.azure_storage_container,
        blob_key=payload.blob_key,
        file_name=payload.file_name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        uploaded_by=current_user.id,
    )
    db.add(attachment)
    db.commit()

    row = db.execute(text(_SELECT_BY_ID), {"id": str(attachment.id)}).mappings().first()
    return {**dict(row), "download_url": generate_download_sas_url(row["blob_key"])}


@router.delete("/{entry_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank_attachment(
    entry_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    attachment = db.get(VendorBankAttachment, attachment_id)
    if not attachment or attachment.vendor_tracker_entry_id != entry_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    try:
        delete_blob(attachment.blob_key)
    except ResourceNotFoundError:
        pass

    db.delete(attachment)
    db.commit()


@router.get("/vendor-master/{vendor_code}/attachments", response_model=list[VendorMasterAttachmentOut])
def list_vendor_master_attachments(vendor_code: str, db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(VendorMasterAttachment).filter(VendorMasterAttachment.vendor_code == vendor_code).order_by(
        VendorMasterAttachment.downloaded_at.desc()
    ).all()
    return [
        {
            "id": r.id,
            "vendor_code": r.vendor_code,
            "file_name": r.file_name,
            "content_type": r.content_type,
            "size_bytes": r.size_bytes,
            "smartpal_uploaded_by": r.smartpal_uploaded_by,
            "smartpal_uploaded_at": r.smartpal_uploaded_at,
            "download_url": generate_download_sas_url(r.blob_key),
        }
        for r in rows
    ]
