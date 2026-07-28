import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType
from app.models.audit_log import AuditLog


def write_audit_log(
    db: Session,
    *,
    entity_type: AuditEntityType,
    entity_id: uuid.UUID,
    action: AuditAction,
    changed_by: uuid.UUID | None,
    summary: str,
    changes: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            entity_type=entity_type.value,
            entity_id=entity_id,
            action=action.value,
            changed_by=changed_by,
            changes=changes,
            summary=summary,
        )
    )


def diff_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Returns {field: {old, new}} for fields present in `after` whose value differs from `before`."""
    changes: dict[str, dict[str, Any]] = {}
    for field, new_value in after.items():
        old_value = before.get(field)
        if old_value != new_value:
            changes[field] = {"old": _jsonable(old_value), "new": _jsonable(new_value)}
    return changes


def _jsonable(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "value") and not isinstance(value, (int, float, str, bool)):
        return value.value
    return value
