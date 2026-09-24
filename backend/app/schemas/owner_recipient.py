import uuid
from datetime import datetime

from app.schemas.base import CamelModel


class OwnerRecipientOut(CamelModel):
    id: uuid.UUID
    name: str | None
    email: str
    is_active: bool
    created_at: datetime


class OwnerRecipientCreateRequest(CamelModel):
    name: str | None = None
    email: str


class OwnerRecipientUpdateRequest(CamelModel):
    name: str | None = None
    email: str | None = None
    is_active: bool | None = None
