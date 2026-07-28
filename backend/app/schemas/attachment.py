import uuid
from datetime import datetime

from app.schemas.base import CamelModel


class AttachmentInitRequest(CamelModel):
    file_name: str
    content_type: str


class AttachmentInitResponse(CamelModel):
    blob_key: str
    upload_url: str


class AttachmentCompleteRequest(CamelModel):
    blob_key: str
    file_name: str
    content_type: str
    size_bytes: int


class AttachmentOut(CamelModel):
    id: uuid.UUID
    pi_entry_id: uuid.UUID
    file_name: str
    content_type: str
    size_bytes: int
    uploaded_by: uuid.UUID
    uploaded_by_name: str
    uploaded_at: datetime
    download_url: str
