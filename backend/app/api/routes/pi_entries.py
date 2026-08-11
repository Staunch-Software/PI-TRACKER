import uuid
from datetime import date, datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, FOLLOW_UP_STATUS_LABELS, UserRole
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
    pe.final_invoice_received, pe.po_number, pe.invoice_no, pe.invoice_date, pe.invoice_file_name,
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


# Builds the WHERE clause + bound params shared by list_pi_entries and export_pi_entries, so the
# two endpoints can never drift apart on what "the current filters" mean.
def _build_where_clause(
    search: str | None,
    status_filter: list[str] | None,
    vessel_id: list[uuid.UUID] | None,
    vendor_id: list[uuid.UUID] | None,
    currency: list[str] | None,
    overdue: bool | None,
    no_invoice_attached: bool | None,
    dpr_date_from: date | None,
    dpr_date_to: date | None,
    payment_date_from: date | None,
    payment_date_to: date | None,
    invoice_date_from: date | None,
    invoice_date_to: date | None,
) -> tuple[str, dict]:
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
        placeholders = ", ".join(f":vessel_id_{i}" for i in range(len(vessel_id)))
        where_clauses.append(f"pe.vessel_id IN ({placeholders})")
        for i, v in enumerate(vessel_id):
            params[f"vessel_id_{i}"] = str(v)
    if vendor_id:
        placeholders = ", ".join(f":vendor_id_{i}" for i in range(len(vendor_id)))
        where_clauses.append(f"pe.vendor_id IN ({placeholders})")
        for i, v in enumerate(vendor_id):
            params[f"vendor_id_{i}"] = str(v)
    if currency:
        placeholders = ", ".join(f":currency_{i}" for i in range(len(currency)))
        where_clauses.append(f"pe.currency IN ({placeholders})")
        for i, c in enumerate(currency):
            params[f"currency_{i}"] = c
    if overdue:
        where_clauses.append(
            "(CURRENT_DATE - pe.payment_date) > 30 AND pe.followup_status NOT IN ('RECEIVED', 'NOT_APPLICABLE')"
        )
    if no_invoice_attached:
        where_clauses.append("NOT EXISTS (SELECT 1 FROM invoice_attachments ia WHERE ia.pi_entry_id = pe.id)")
    if dpr_date_from:
        where_clauses.append("pe.dpr_date >= :dpr_date_from")
        params["dpr_date_from"] = dpr_date_from
    if dpr_date_to:
        # A space before "::date" matters here — SQLAlchemy's text() bind-parameter parser
        # doesn't recognize ":name" as a parameter when immediately followed by "::" with no
        # space (it passes ":name::date" through to psycopg2 literally, which is a syntax
        # error). Confirmed while testing this change; audit_log.py's date_to filter has the
        # same latent bug from the same no-space pattern.
        where_clauses.append("pe.dpr_date < (:dpr_date_to ::date + INTERVAL '1 day')")
        params["dpr_date_to"] = dpr_date_to
    if payment_date_from:
        where_clauses.append("pe.payment_date >= :payment_date_from")
        params["payment_date_from"] = payment_date_from
    if payment_date_to:
        where_clauses.append("pe.payment_date < (:payment_date_to ::date + INTERVAL '1 day')")
        params["payment_date_to"] = payment_date_to
    if invoice_date_from:
        where_clauses.append("pe.invoice_date >= :invoice_date_from")
        params["invoice_date_from"] = invoice_date_from
    if invoice_date_to:
        where_clauses.append("pe.invoice_date < (:invoice_date_to ::date + INTERVAL '1 day')")
        params["invoice_date_to"] = invoice_date_to

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    return where_sql, params


@router.get("", response_model=PaginatedResult[PiEntryOut])
def list_pi_entries(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    search: str | None = Query(default=None),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    vessel_id: list[uuid.UUID] | None = Query(default=None),
    vendor_id: list[uuid.UUID] | None = Query(default=None),
    currency: list[str] | None = Query(default=None),
    overdue: bool | None = Query(default=None),
    no_invoice_attached: bool | None = Query(default=None),
    dpr_date_from: date | None = Query(default=None),
    dpr_date_to: date | None = Query(default=None),
    payment_date_from: date | None = Query(default=None),
    payment_date_to: date | None = Query(default=None),
    invoice_date_from: date | None = Query(default=None),
    invoice_date_to: date | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> dict:
    where_sql, params = _build_where_clause(
        search, status_filter, vessel_id, vendor_id, currency, overdue, no_invoice_attached,
        dpr_date_from, dpr_date_to, payment_date_from, payment_date_to, invoice_date_from, invoice_date_to,
    )

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


# Header order/labels mirror _HEADER_MAP in app/services/importer.py so a file exported here
# (optionally re-filtered/edited) can be re-imported without any column remapping. Columns not
# recognized by the importer (S.No., Days Since Payment, Invoice File Name, Attached By, Date
# Attached, PO Number) are included for readability but are simply ignored on re-import.
_EXPORT_HEADERS = [
    ("S.No.", "seq_no"),
    ("DPR No.", "dpr_no"),
    ("Follow up Status", "followup_status"),
    ("DPR Date", "dpr_date"),
    ("Vessel", "vessel_name"),
    ("Vendor", "vendor_name"),
    ("Service Details", "service_details"),
    ("FC Amount", "fc_amount"),
    ("Amount INR", "amount_inr"),
    ("Currency", "currency"),
    ("Payment Date", "payment_date"),
    ("Payment Reference", "payment_reference"),
    ("Days Since Payment", "days_since_payment"),
    ("Last Known Remark", "last_known_remark"),
    ("Reminder 1 Sent Date", "reminder_1_sent_date"),
    ("Reminder 2 Sent Date", "reminder_2_sent_date"),
    ("Final Invoice Received", "final_invoice_received"),
    ("Invoice No", "invoice_no"),
    ("Invoice Date", "invoice_date"),
    ("Attached By", "attached_by_name"),
    ("Date Attached", "date_attached"),
    ("Notes", "notes"),
    ("PO Number", "po_number"),
]


@router.get("/export")
def export_pi_entries(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    search: str | None = Query(default=None),
    status_filter: list[str] | None = Query(default=None, alias="status"),
    vessel_id: list[uuid.UUID] | None = Query(default=None),
    vendor_id: list[uuid.UUID] | None = Query(default=None),
    currency: list[str] | None = Query(default=None),
    overdue: bool | None = Query(default=None),
    no_invoice_attached: bool | None = Query(default=None),
    dpr_date_from: date | None = Query(default=None),
    dpr_date_to: date | None = Query(default=None),
    payment_date_from: date | None = Query(default=None),
    payment_date_to: date | None = Query(default=None),
    invoice_date_from: date | None = Query(default=None),
    invoice_date_to: date | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    """Exports every row matching the current tracker filters (no pagination) as an .xlsx
    workbook — the same filter params the list endpoint takes, so "export" always means
    "export exactly what's on screen right now"."""
    where_sql, params = _build_where_clause(
        search, status_filter, vessel_id, vendor_id, currency, overdue, no_invoice_attached,
        dpr_date_from, dpr_date_to, payment_date_from, payment_date_to, invoice_date_from, invoice_date_to,
    )

    if sort_by and sort_by in _SORTABLE_COLUMNS:
        order_sql = f"ORDER BY {_SORTABLE_COLUMNS[sort_by]} {sort_dir.upper()} NULLS LAST, pe.seq_no ASC"
    else:
        order_sql = "ORDER BY pe.seq_no ASC"

    rows = db.execute(
        text(f"SELECT {_SELECT_COLUMNS} {_FROM_JOIN} {where_sql} {order_sql}"), params
    ).mappings().all()

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "PI Follow-up Tracker"
    sheet.append([label for label, _ in _EXPORT_HEADERS])

    for row in rows:
        values = []
        for _label, field in _EXPORT_HEADERS:
            value = row[field]
            if field == "followup_status":
                value = FOLLOW_UP_STATUS_LABELS.get(value, value)
            elif field == "final_invoice_received":
                value = "Yes" if value else "No"
            elif isinstance(value, datetime):
                value = value.replace(tzinfo=None)
            values.append(value)
        sheet.append(values)

    for col_idx in range(1, len(_EXPORT_HEADERS) + 1):
        sheet.column_dimensions[sheet.cell(row=1, column=col_idx).column_letter].width = 20

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    filename = f"PI_Followup_Tracker_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
