import uuid
from datetime import datetime

from app.schemas.base import CamelModel


class VendorBankAttachmentInitRequest(CamelModel):
    file_name: str
    content_type: str


class VendorBankAttachmentInitResponse(CamelModel):
    blob_key: str
    upload_url: str


class VendorBankAttachmentCompleteRequest(CamelModel):
    blob_key: str
    file_name: str
    content_type: str
    size_bytes: int


class VendorBankAttachmentOut(CamelModel):
    id: uuid.UUID
    vendor_tracker_entry_id: uuid.UUID
    file_name: str
    content_type: str
    size_bytes: int
    uploaded_by: uuid.UUID
    uploaded_by_name: str
    uploaded_at: datetime
    download_url: str


class VendorMasterAttachmentOut(CamelModel):
    id: uuid.UUID
    vendor_code: str
    file_name: str
    content_type: str
    size_bytes: int
    smartpal_uploaded_by: str | None
    smartpal_uploaded_at: str | None
    download_url: str
