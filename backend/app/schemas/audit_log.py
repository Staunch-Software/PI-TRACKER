import uuid
from datetime import datetime
from typing import Any

from app.core.enums import AuditAction, AuditEntityType
from app.schemas.base import CamelModel


class AuditLogEntryOut(CamelModel):
    id: int
    entity_type: AuditEntityType
    entity_id: uuid.UUID
    action: AuditAction
    changed_by: uuid.UUID | None
    changed_by_name: str | None
    changes: dict[str, Any] | None
    summary: str | None
    created_at: datetime
    is_read: bool
    vessel_id: uuid.UUID | None
    vessel_name: str | None
