import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.pi_entry import PiEntry
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vessel import Vessel
from app.schemas.common import PaginatedResult
from app.schemas.pi_entry import PiEntryCreateRequest, PiEntryOut, PiEntryUpdateRequest
from app.services.audit import diff_fields, write_audit_log

router = APIRouter(prefix="/pi-entries", tags=["pi-entries"])

_SELECT_COLUMNS = """
    pe.id, pe.seq_no, pe.dpr_no, pe.dpr_date, pe.vessel_id, v.name AS vessel_name,
    pe.vendor_id, ve.name AS vendor_name, pe.service_details, pe.amount_inr, pe.fc_amount,
    pe.currency, pe.payment_date, pe.payment_reference,
    (CURRENT_DATE - pe.payment_date) AS days_since_payment,
    pe.followup_status, pe.last_known_remark, pe.reminder_1_sent_date, pe.reminder_2_sent_date,
    pe.final_invoice_received, pe.invoice_no, pe.invoice_date, pe.invoice_file_name,
    pe.attached_by, au.full_name AS attached_by_name, pe.date_attached, pe.notes,
    pe.created_by, pe.created_at, pe.updated_by, pe.updated_at,
    (SELECT count(*) FROM invoice_attachments ia WHERE ia.pi_entry_id = pe.id) AS attachment_count
"""

_FROM_JOIN = """
    FROM pi_entries pe
    JOIN vessels v ON v.id = pe.vessel_id
    JOIN vendors ve ON ve.id = pe.vendor_id
    LEFT JOIN users au ON au.id = pe.attached_by
"""

# Whitelisted sort columns (frontend key -> safe SQL expression) — never interpolate the
# sort_by query param directly into SQL.
_SORTABLE_COLUMNS = {
    "dprNo": "pe.dpr_no",
    "dprDate": "pe.dpr_date",
    "vesselName": "v.name",
    "vendorName": "ve.name",
    "amountInr": "pe.amount_inr",
    "paymentDate": "pe.payment_date",
    "daysSincePayment": "(CURRENT_DATE - pe.payment_date)",
    "followupStatus": "pe.followup_status",
}


@router.get("", response_model=PaginatedResult[PiEntryOut])
def list_pi_entries(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    search: str | None = Query(default=None),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    vessel_id: uuid.UUID | None = Query(default=None),
    vendor_id: uuid.UUID | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    where_clauses = []
    params: dict = {}

    if search:
        where_clauses.append(
            "(pe.dpr_no ILIKE :search OR v.name ILIKE :search OR ve.name ILIKE :search "
            "OR pe.service_details ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    if status_filter:
        placeholders = ", ".join(f":status_{i}" for i in range(len(status_filter)))
        where_clauses.append(f"pe.followup_status IN ({placeholders})")
        for i, s in enumerate(status_filter):
            params[f"status_{i}"] = s
    if vessel_id:
        where_clauses.append("pe.vessel_id = :vessel_id")
        params["vessel_id"] = str(vessel_id)
    if vendor_id:
        where_clauses.append("pe.vendor_id = :vendor_id")
        params["vendor_id"] = str(vendor_id)

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    total = db.execute(text(f"SELECT count(*) {_FROM_JOIN} {where_sql}"), params).scalar_one()

    if sort_by and sort_by in _SORTABLE_COLUMNS:
        order_sql = f"ORDER BY {_SORTABLE_COLUMNS[sort_by]} {sort_dir.upper()} NULLS LAST, pe.seq_no ASC"
    else:
        # Default: S.No. order (matches the original spreadsheet's row order, 1..N).
        order_sql = "ORDER BY pe.seq_no ASC"

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(
        text(f"SELECT {_SELECT_COLUMNS} {_FROM_JOIN} {where_sql} {order_sql} LIMIT :limit OFFSET :offset"),
        params,
    ).mappings().all()

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{pi_entry_id}/position")
def get_pi_entry_position(
    pi_entry_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(get_current_user)
) -> dict:
    """0-based rank of this entry under the default (unfiltered, seq_no ascending) ordering —
    lets the frontend jump straight to the page containing it instead of filtering the list."""
    entry = db.get(PiEntry, pi_entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI entry not found")
    position = db.query(PiEntry).filter(PiEntry.seq_no < entry.seq_no).count()
    return {"position": position}


@router.get("/{pi_entry_id}", response_model=PiEntryOut)
def get_pi_entry(pi_entry_id: uuid.UUID, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> dict:
    row = db.execute(
        text(f"SELECT {_SELECT_COLUMNS} {_FROM_JOIN} WHERE pe.id = :id"), {"id": str(pi_entry_id)}
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI entry not found")
    return dict(row)


@router.post("", response_model=PiEntryOut, status_code=status.HTTP_201_CREATED)
def create_pi_entry(
    payload: PiEntryCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    vessel = db.get(Vessel, payload.vessel_id)
    vendor = db.get(Vendor, payload.vendor_id)
    if not vessel or not vendor:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown vessel or vendor")

    if db.query(PiEntry).filter(PiEntry.dpr_no == payload.dpr_no).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"DPR No. '{payload.dpr_no}' already exists")

    entry = PiEntry(**payload.model_dump(), created_by=current_user.id)
    db.add(entry)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.PI_ENTRY,
        entity_id=entry.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} added PI {entry.dpr_no} for {vessel.name} / {vendor.name}",
    )
    db.commit()

    return get_pi_entry(entry.id, db=db, _=current_user)


@router.patch("/{pi_entry_id}", response_model=PiEntryOut)
def update_pi_entry(
    pi_entry_id: uuid.UUID,
    payload: PiEntryUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    entry = db.get(PiEntry, pi_entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI entry not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return get_pi_entry(pi_entry_id, db=db, _=current_user)

    if "dpr_no" in updates and updates["dpr_no"] != entry.dpr_no:
        if db.query(PiEntry).filter(PiEntry.dpr_no == updates["dpr_no"], PiEntry.id != pi_entry_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"DPR No. '{updates['dpr_no']}' already exists")

    before = {field: getattr(entry, field) for field in updates}
    for field, value in updates.items():
        setattr(entry, field, value)
    entry.updated_by = current_user.id

    changes = diff_fields(before, updates)
    if changes:
        write_audit_log(
            db,
            entity_type=AuditEntityType.PI_ENTRY,
            entity_id=entry.id,
            action=AuditAction.UPDATE,
            changed_by=current_user.id,
            summary=f"{current_user.full_name} updated PI {entry.dpr_no} ({', '.join(changes.keys())})",
            changes=changes,
        )
    db.commit()

    return get_pi_entry(pi_entry_id, db=db, _=current_user)
