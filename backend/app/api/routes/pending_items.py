from datetime import date, datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy.orm import Session

from app.api.deps import require_module_access
from app.db.session import get_db
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.schemas.common import PaginatedResult
from app.schemas.pending_items import PendingItemOut, PendingItemsCountEntry, PendingItemsFilterOptions

_STAGES = ("Requisition", "Purchase Order", "Invoice")
_OWNER_ROLES = ("TSI", "TA")

router = APIRouter(
    prefix="/pending-items",
    tags=["pending-items"],
    dependencies=[Depends(require_module_access("pending_items"))],
)

# Vessel -> (TSI, TA) assignment, provided by the user 2026-11-15. No DB table for this yet — it's
# a short, infrequently-changed list, so it lives here as code rather than behind an admin screen.
# A vessel not in this mapping contributes no rows to this report at all.
_VESSEL_OWNERS: dict[str, tuple[str, str]] = {
    "AMNSI MAXIMUS": ("Murtuza", "Sunil"),
    "AMNSI STALLION": ("Murtuza", "Sunil"),
    "GCL GANGA": ("Gaurav", "Jayasri"),
    "GCL TAPI": ("Murtuza", "Bharath"),
    "AM UMANG": ("Abhisek", "Gayathri"),
    "AMNS TUFMAX": ("Abhinav", "Viswa"),
    "AMNS POLAR": ("Abhinav", "Viswa"),
    "GCL SARASWATI": ("Abhinav", "Bharath"),
    "GCL FOS": ("Gaurav", "Bharath"),
    "GCL SABARMATI": ("Pavan", "Bharath"),
    "GCL YAMUNA": ("Gaurav", "Jayasri"),
    "GCL NARMADA": ("Pavan", "Viswa"),
    "AM KIRTI": ("Pavan", "Gayathiri"),
    "AM TARANG": ("Pavan", "Sunil"),
}

_PENDING_STATUSES = {"Pending"}
_APPROVED_STATUSES = {"Approved", "Finally Approved"}


def _owner(vessel_name: str | None, pending_side_role: str) -> tuple[str, str | None]:
    """pending_side_role is the role ('TSI' or 'TA') that owns the item while it's on the
    "pending" side of a stage; the other role owns it once that stage is approved. Returns
    (owner_role, owner_name) — owner_name is None for a vessel outside _VESSEL_OWNERS."""
    tsi, ta = _VESSEL_OWNERS.get((vessel_name or "").strip().upper(), (None, None))
    if pending_side_role == "TSI":
        return "TSI", tsi
    return "TA", ta


def _ageing(reference_date: date | None) -> int | None:
    if not reference_date:
        return None
    return (date.today() - reference_date).days


def _compute_pending_items(db: Session) -> list[PendingItemOut]:
    items: list[PendingItemOut] = []

    # Requisition: Pending -> TSI's job (ageing since created); Approved/Finally Approved -> TA's
    # job (ageing since it was approved, i.e. since it became TA's job).
    prs = (
        db.query(PrEntry)
        .filter(PrEntry.approval_flag.in_(_PENDING_STATUSES | _APPROVED_STATUSES))
        .all()
    )
    for pr in prs:
        is_pending = pr.approval_flag in _PENDING_STATUSES
        owner_role, owner_name = _owner(pr.vessel_name, "TSI" if is_pending else "TA")
        if owner_name is None:
            continue
        reference_date = pr.created_date if is_pending else (pr.approved_date or pr.created_date)
        items.append(
            PendingItemOut(
                stage="Requisition",
                reference_no=pr.requisition_no,
                vessel_name=pr.vessel_name,
                vendor=None,
                status=pr.approval_flag,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=pr.pending_since if is_pending and pr.pending_since is not None else _ageing(reference_date),
                reference_date=reference_date,
            )
        )

    # Purchase Order: Pending -> TA's job; Approved/Finally Approved -> TSI's job.
    pos = (
        db.query(PoEntry)
        .filter(PoEntry.approved_status.in_(_PENDING_STATUSES | _APPROVED_STATUSES))
        .all()
    )
    for po in pos:
        is_pending = po.approved_status in _PENDING_STATUSES
        owner_role, owner_name = _owner(po.vessel_name, "TA" if is_pending else "TSI")
        if owner_name is None:
            continue
        reference_date = po.created_date if is_pending else (po.approved_date or po.created_date)
        items.append(
            PendingItemOut(
                stage="Purchase Order",
                reference_no=po.po_no,
                vessel_name=po.vessel_name,
                vendor=po.vendor,
                status=po.approved_status,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=po.pending_days if is_pending and po.pending_days is not None else _ageing(reference_date),
                reference_date=reference_date,
            )
        )

    # Invoice: Pending (Approval) -> TA's job; Approved/Finally Approved -> TSI's job. No
    # "approved date" column exists on this table, so both sides age from invoice_date.
    invoices = (
        db.query(SmartpalInvoiceEntry)
        .filter(
            (SmartpalInvoiceEntry.status.ilike("Pending%"))
            | (SmartpalInvoiceEntry.status.in_(_APPROVED_STATUSES))
        )
        .all()
    )
    for inv in invoices:
        is_pending = bool(inv.status) and inv.status.lower().startswith("pending")
        owner_role, owner_name = _owner(inv.vessel_name, "TA" if is_pending else "TSI")
        if owner_name is None:
            continue
        items.append(
            PendingItemOut(
                stage="Invoice",
                reference_no=inv.invoice_no or inv.vendor_invoice_no,
                vessel_name=inv.vessel_name,
                vendor=inv.vendor_name,
                status=inv.status,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=_ageing(inv.invoice_date),
                reference_date=inv.invoice_date,
            )
        )

    return items


def _filtered(
    items: list[PendingItemOut],
    search: str | None,
    vessel_name: list[str] | None,
    stage: list[str] | None,
    owner_role: list[str] | None,
    owner_name: list[str] | None,
) -> list[PendingItemOut]:
    s_clean = search.strip().lower() if isinstance(search, str) and search.strip() else None
    v_clean = vessel_name if isinstance(vessel_name, list) and vessel_name else None
    st_clean = stage if isinstance(stage, list) and stage else None
    or_clean = owner_role if isinstance(owner_role, list) and owner_role else None
    on_clean = owner_name if isinstance(owner_name, list) and owner_name else None

    def matches(item: PendingItemOut) -> bool:
        if v_clean and item.vessel_name not in v_clean:
            return False
        if st_clean and item.stage not in st_clean:
            return False
        if or_clean and item.owner_role not in or_clean:
            return False
        if on_clean and item.owner_name not in on_clean:
            return False
        if s_clean:
            haystack = " ".join(
                filter(None, [item.reference_no, item.vessel_name, item.vendor, item.status, item.owner_name])
            ).lower()
            if s_clean not in haystack:
                return False
        return True

    return [item for item in items if matches(item)]


_SORT_KEYS = {
    "stage": lambda i: i.stage or "",
    "referenceNo": lambda i: i.reference_no or "",
    "vesselName": lambda i: i.vessel_name or "",
    "vendor": lambda i: i.vendor or "",
    "status": lambda i: i.status or "",
    "ownerRole": lambda i: i.owner_role or "",
    "ownerName": lambda i: i.owner_name or "",
    "ageingDays": lambda i: i.ageing_days if i.ageing_days is not None else -1,
}


def _sorted(items: list[PendingItemOut], sort_by: str | None, sort_dir: str) -> list[PendingItemOut]:
    key = _SORT_KEYS.get(sort_by) if sort_by else None
    if key is None:
        return sorted(items, key=_SORT_KEYS["ageingDays"], reverse=True)
    return sorted(items, key=key, reverse=(sort_dir == "desc"))


@router.get("", response_model=PaginatedResult[PendingItemOut])
def list_pending_items(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    owner_role: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[PendingItemOut]:
    items = _sorted(_filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name), sort_by, sort_dir)
    total = len(items)
    start = (page - 1) * page_size
    return PaginatedResult[PendingItemOut](items=items[start : start + page_size], total=total, page=page, page_size=page_size)


@router.get("/counts", response_model=list[PendingItemsCountEntry])
def get_pending_items_counts(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
) -> list[PendingItemsCountEntry]:
    """Row count per (stage, owner_role) combination, under the current search/vessel/owner-name
    filters but WITHOUT stage/owner_role themselves (those are what the frontend's tabs and
    sub-tabs pick) — drives the count badge on each tab/sub-tab regardless of which one is
    currently selected."""
    items = _filtered(_compute_pending_items(db), search, vessel_name, None, None, owner_name)
    counts: dict[tuple[str, str], int] = {}
    for item in items:
        key = (item.stage, item.owner_role)
        counts[key] = counts.get(key, 0) + 1
    return [
        PendingItemsCountEntry(stage=stage, owner_role=role, count=counts.get((stage, role), 0))
        for stage in _STAGES
        for role in _OWNER_ROLES
    ]


@router.get("/filter-options", response_model=PendingItemsFilterOptions)
def get_pending_items_filter_options(db: Session = Depends(get_db)) -> PendingItemsFilterOptions:
    items = _compute_pending_items(db)
    return PendingItemsFilterOptions(
        vessel_name=sorted({i.vessel_name for i in items if i.vessel_name}),
        stage=sorted({i.stage for i in items if i.stage}),
        owner_name=sorted({i.owner_name for i in items if i.owner_name}),
        status=sorted({i.status for i in items if i.status}),
    )


_EXPORT_COLUMNS: list[tuple[str, str]] = [
    ("Stage", "stage"),
    ("Reference No.", "reference_no"),
    ("Vessel", "vessel_name"),
    ("Vendor", "vendor"),
    ("Status", "status"),
    ("Owner Role", "owner_role"),
    ("Owner Name", "owner_name"),
    ("Ageing (Days)", "ageing_days"),
    ("Reference Date", "reference_date"),
]


@router.get("/export")
def export_pending_items(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    owner_role: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    items = _sorted(_filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name), sort_by, sort_dir)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "TSI-TA Pending"

    header_fill = PatternFill("solid", fgColor="0F4C81")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    headers = [label for label, _ in _EXPORT_COLUMNS]
    sheet.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = sheet.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for row in items:
        data = row.model_dump()
        values = []
        for _label, field in _EXPORT_COLUMNS:
            value = data.get(field)
            if isinstance(value, datetime):
                value = value.replace(tzinfo=None)
            values.append(value)
        sheet.append(values)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    # Frontend always sends exactly one stage + one owner_role (its tab/sub-tab selection), so
    # name the file after them; falls back to a generic name for any other combination (e.g. a
    # future "export everything" caller).
    stage_clean = [s for s in (stage or []) if s]
    role_clean = [r for r in (owner_role or []) if r]
    if len(stage_clean) == 1 and len(role_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_{role_clean[0]}_Pending.xlsx"
    else:
        filename = "TSI_TA_Pending_Items.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
