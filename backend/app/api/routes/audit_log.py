import uuid
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.audit_log import AuditLogEntryOut
from app.schemas.common import PaginatedResult

router = APIRouter(prefix="/audit-log", tags=["audit-log"])

_SELECT = """
    SELECT al.id, al.entity_type, al.entity_id, al.action, al.changed_by,
           u.full_name AS changed_by_name, al.changes, al.summary, al.created_at,
           (alr.audit_log_id IS NOT NULL) AS is_read,
           pe.vessel_id, v.name AS vessel_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.changed_by
    LEFT JOIN audit_log_reads alr ON alr.audit_log_id = al.id AND alr.user_id = :current_user_id
    LEFT JOIN pi_entries pe ON al.entity_type = 'pi_entry' AND pe.id = al.entity_id
    LEFT JOIN vessels v ON v.id = pe.vessel_id
"""


@router.get("", response_model=PaginatedResult[AuditLogEntryOut])
def list_audit_log(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    search: str | None = Query(default=None),
    action: list[str] | None = Query(default=None),
    vessel_id: list[uuid.UUID] | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    read_state: str | None = Query(default=None, description="unread | read"),
    scope: str | None = Query(default=None, description="mine — restrict to entries authored by the current user"),
    entity_type: str | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    where_clauses = []
    params: dict = {"current_user_id": str(current_user.id)}

    if search:
        where_clauses.append("al.summary ILIKE :search")
        params["search"] = f"%{search}%"
    if action:
        placeholders = ", ".join(f":action_{i}" for i in range(len(action)))
        where_clauses.append(f"al.action IN ({placeholders})")
        for i, a in enumerate(action):
            params[f"action_{i}"] = a
    if vessel_id:
        placeholders = ", ".join(f":vessel_{i}" for i in range(len(vessel_id)))
        where_clauses.append(f"pe.vessel_id IN ({placeholders})")
        for i, v in enumerate(vessel_id):
            params[f"vessel_{i}"] = str(v)
    if date_from:
        where_clauses.append("al.created_at >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("al.created_at < (:date_to::date + INTERVAL '1 day')")
        params["date_to"] = date_to
    if read_state == "unread":
        where_clauses.append("alr.audit_log_id IS NULL")
    elif read_state == "read":
        where_clauses.append("alr.audit_log_id IS NOT NULL")
    if scope == "mine":
        where_clauses.append("al.changed_by = :current_user_id")
    if entity_type:
        where_clauses.append("al.entity_type = :entity_type")
        params["entity_type"] = entity_type
    if entity_id:
        where_clauses.append("al.entity_id = :entity_id")
        params["entity_id"] = str(entity_id)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    total = db.execute(
        text(
            f"""
            SELECT count(*) FROM audit_log al
            LEFT JOIN audit_log_reads alr ON alr.audit_log_id = al.id AND alr.user_id = :current_user_id
            LEFT JOIN pi_entries pe ON al.entity_type = 'pi_entry' AND pe.id = al.entity_id
            {where_sql}
            """
        ),
        params,
    ).scalar_one()

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(
        text(f"{_SELECT} {where_sql} ORDER BY al.created_at DESC LIMIT :limit OFFSET :offset"), params
    ).mappings().all()

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/{audit_log_id}/read")
def mark_as_read(
    audit_log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
) -> dict[str, bool]:
    db.execute(
        text(
            "INSERT INTO audit_log_reads (audit_log_id, user_id) VALUES (:audit_log_id, :user_id) "
            "ON CONFLICT (audit_log_id, user_id) DO NOTHING"
        ),
        {"audit_log_id": audit_log_id, "user_id": str(current_user.id)},
    )
    db.commit()
    return {"ok": True}
