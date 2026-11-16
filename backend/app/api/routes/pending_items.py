from collections import Counter, defaultdict
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
from app.schemas.pending_items import (
    PendingDashboardOwnerGroup,
    PendingDashboardSummaryResponse,
    PendingDashboardTotals,
    PendingDashboardVesselRow,
    PendingItemOut,
    PendingItemsCountEntry,
    PendingItemsFilterOptions,
    PendingOwnerBreakdown,
    PendingStageBreakdown,
    PendingVesselCount,
)

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
    "AM KIRTI": ("Pavan", "Gayathri"),
    "AM TARANG": ("Pavan", "Sunil"),
}

# "Finally Approved" is a terminal state — fully done, not pending for anyone — confirmed with
# the user 2026-11-15 it must NOT be lumped in with plain "Approved" (which still has an open
# TSI/TA action against it). So it's deliberately excluded from both sets below: rows in that
# status are dropped entirely from this report across all three stages.
_PENDING_STATUSES = {"Pending"}
_APPROVED_STATUSES = {"Approved"}


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

    # Requisition: Pending -> TSI's job (ageing since created); Approved -> TA's job (ageing
    # since it was approved, i.e. since it became TA's job). Finally Approved is excluded
    # entirely — see _APPROVED_STATUSES.
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
                title=pr.title,
                vessel_name=pr.vessel_name.strip().upper() if pr.vessel_name else None,
                vendor=None,
                status=pr.approval_flag,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=pr.pending_since if is_pending and pr.pending_since is not None else _ageing(reference_date),
                reference_date=reference_date,
            )
        )

    # Purchase Order: Pending -> TA's job; Approved -> TSI's job. Finally Approved excluded.
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
                title=po.title,
                vessel_name=po.vessel_name.strip().upper() if po.vessel_name else None,
                vendor=po.vendor,
                status=po.approved_status,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=po.pending_days if is_pending and po.pending_days is not None else _ageing(reference_date),
                reference_date=reference_date,
            )
        )

    # Invoice: Pending (Approval) -> TA's job; Approved -> TSI's job. Finally Approved excluded.
    # No "approved date" column exists on this table, so both sides age from invoice_date.
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
                title=None,
                vessel_name=inv.vessel_name.strip().upper() if inv.vessel_name else None,
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
    ageing_bracket: str | None = None,
) -> list[PendingItemOut]:
    s_clean = search.strip().lower() if isinstance(search, str) and search.strip() else None
    v_clean = vessel_name if isinstance(vessel_name, list) and vessel_name else None
    st_clean = stage if isinstance(stage, list) and stage else None
    or_clean = owner_role if isinstance(owner_role, list) and owner_role else None
    on_clean = owner_name if isinstance(owner_name, list) and owner_name else None

    or_filter = None
    if or_clean:
        valid_roles = [r for r in or_clean if r.upper() != "ALL"]
        if valid_roles:
            or_filter = valid_roles

    def matches(item: PendingItemOut) -> bool:
        if v_clean and (item.vessel_name or "").strip().upper() not in [v.strip().upper() for v in v_clean]:
            return False
        if st_clean and item.stage not in st_clean:
            return False
        if or_filter and item.owner_role not in or_filter:
            return False
        if on_clean and item.owner_name not in on_clean:
            return False
        if ageing_bracket:
            age = item.ageing_days if item.ageing_days is not None else 0
            if ageing_bracket == "< 7 Days":
                if age >= 7:
                    return False
            elif ageing_bracket == "7 - 14 Days":
                if not (7 <= age <= 14):
                    return False
            elif ageing_bracket == "15 - 30 Days":
                if not (15 <= age <= 30):
                    return False
            elif ageing_bracket == "> 30 Days":
                if age <= 30:
                    return False
        if s_clean:
            haystack = " ".join(
                filter(None, [item.reference_no, item.title, item.vessel_name, item.vendor, item.status, item.owner_name])
            ).lower()
            if s_clean not in haystack:
                return False
        return True

    return [item for item in items if matches(item)]


_SORT_KEYS = {
    "stage": lambda i: i.stage or "",
    "referenceNo": lambda i: i.reference_no or "",
    "title": lambda i: (i.title or "").lower(),
    "vesselName": lambda i: i.vessel_name or "",
    "vendor": lambda i: i.vendor or "",
    "status": lambda i: i.status or "",
    "ownerRole": lambda i: i.owner_role or "",
    "ownerName": lambda i: i.owner_name or "",
    "ageingDays": lambda i: i.ageing_days if i.ageing_days is not None else -1,
    "referenceDate": lambda i: i.reference_date or date.min,
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
    ageing_bracket: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[PendingItemOut]:
    items = _sorted(
        _filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name, ageing_bracket),
        sort_by,
        sort_dir,
    )
    total = len(items)
    start = (page - 1) * page_size
    return PaginatedResult[PendingItemOut](items=items[start : start + page_size], total=total, page=page, page_size=page_size)


@router.get("/counts", response_model=list[PendingItemsCountEntry])
def get_pending_items_counts(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    ageing_bracket: str | None = Query(default=None),
) -> list[PendingItemsCountEntry]:
    """Row count per (stage, owner_role) combination, under the current search/vessel/owner-name
    filters but WITHOUT stage/owner_role themselves (those are what the frontend's tabs and
    sub-tabs pick) — drives the count badge on each tab/sub-tab regardless of which one is
    currently selected."""
    items = _filtered(_compute_pending_items(db), search, vessel_name, None, None, owner_name, ageing_bracket)
    counts: dict[tuple[str, str], int] = {}
    for item in items:
        key = (item.stage, item.owner_role)
        counts[key] = counts.get(key, 0) + 1
    return [
        PendingItemsCountEntry(stage=stage, owner_role=role, count=counts.get((stage, role), 0))
        for stage in _STAGES
        for role in _OWNER_ROLES
    ]


@router.get("/breakdown", response_model=PendingStageBreakdown)
def get_pending_items_breakdown(
    db: Session = Depends(get_db),
    stage: str = Query(default="Requisition"),
) -> PendingStageBreakdown:
    """Provides dashboard-style breakdown of pending items for an entire stage:
    total counts for TSI vs TA, and each individual TSI/TA owner with their vessel-wise count."""
    items = [i for i in _compute_pending_items(db) if i.stage == stage]
    tsi_total = sum(1 for i in items if i.owner_role == "TSI")
    ta_total = sum(1 for i in items if i.owner_role == "TA")

    owner_groups: dict[tuple[str, str], list[PendingItemOut]] = defaultdict(list)
    for item in items:
        if item.owner_name and item.owner_role:
            owner_groups[(item.owner_name, item.owner_role)].append(item)

    owner_breakdowns: list[PendingOwnerBreakdown] = []
    for (owner_name, owner_role), o_items in owner_groups.items():
        v_counts = Counter(i.vessel_name for i in o_items if i.vessel_name)
        vessels = [
            PendingVesselCount(vessel_name=v_name, count=count)
            for v_name, count in sorted(v_counts.items(), key=lambda x: (-x[1], x[0]))
        ]
        owner_breakdowns.append(
            PendingOwnerBreakdown(
                owner_name=owner_name,
                owner_role=owner_role,
                total_count=len(o_items),
                vessels=vessels,
            )
        )

    # TSI owners first by count desc, then TA owners by count desc
    owner_breakdowns.sort(key=lambda o: (0 if o.owner_role == "TSI" else 1, -o.total_count, o.owner_name))

    return PendingStageBreakdown(
        stage=stage,
        total=len(items),
        tsi_total=tsi_total,
        ta_total=ta_total,
        owners=owner_breakdowns,
    )


def _build_dashboard_role_groups(
    role: str,
    items: list[PendingItemOut],
) -> tuple[list[PendingDashboardOwnerGroup], PendingDashboardTotals]:
    assigned_vessels: dict[str, set[str]] = defaultdict(set)
    for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
        v_canon = vessel.strip().upper()
        if role == "TSI":
            assigned_vessels[tsi].add(v_canon)
        else:
            assigned_vessels[ta].add(v_canon)

    counts: dict[tuple[str, str, str], int] = Counter()
    for item in items:
        if item.owner_role == role and item.owner_name and item.vessel_name:
            v_canon = item.vessel_name.strip().upper()
            counts[(item.owner_name, v_canon, item.stage)] += 1
            assigned_vessels[item.owner_name].add(v_canon)

    owner_groups: list[PendingDashboardOwnerGroup] = []
    tot_req = 0
    tot_po = 0
    tot_inv = 0

    for owner_name, vessels in sorted(assigned_vessels.items()):
        vessel_rows: list[PendingDashboardVesselRow] = []
        o_req = 0
        o_po = 0
        o_inv = 0
        for v in sorted(vessels):
            req_c = counts[(owner_name, v, "Requisition")]
            po_c = counts[(owner_name, v, "Purchase Order")]
            inv_c = counts[(owner_name, v, "Invoice")]
            row_tot = req_c + po_c + inv_c
            vessel_rows.append(
                PendingDashboardVesselRow(
                    vessel_name=v,
                    requisition_count=req_c,
                    po_count=po_c,
                    invoice_count=inv_c,
                    total_count=row_tot,
                )
            )
            o_req += req_c
            o_po += po_c
            o_inv += inv_c

        vessel_rows.sort(key=lambda vr: (-vr.total_count, vr.vessel_name))

        owner_groups.append(
            PendingDashboardOwnerGroup(
                owner_name=owner_name,
                owner_role=role,
                requisition_total=o_req,
                po_total=o_po,
                invoice_total=o_inv,
                total_count=o_req + o_po + o_inv,
                vessels=vessel_rows,
            )
        )
        tot_req += o_req
        tot_po += o_po
        tot_inv += o_inv

    owner_groups.sort(key=lambda og: (-og.total_count, og.owner_name))

    role_totals = PendingDashboardTotals(
        requisition_total=tot_req,
        po_total=tot_po,
        invoice_total=tot_inv,
        grand_total=tot_req + tot_po + tot_inv,
    )
    return owner_groups, role_totals


@router.get("/dashboard-summary", response_model=PendingDashboardSummaryResponse)
def get_pending_items_dashboard_summary(db: Session = Depends(get_db)) -> PendingDashboardSummaryResponse:
    """Dashboard-level overview for TSI/TA Pending:
    Provides structured tables for each TSI and TA showing vessel-wise counts across Requisitions, POs, and Invoices."""
    items = _compute_pending_items(db)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items)

    fleet_totals = PendingDashboardTotals(
        requisition_total=tsi_totals.requisition_total + ta_totals.requisition_total,
        po_total=tsi_totals.po_total + ta_totals.po_total,
        invoice_total=tsi_totals.invoice_total + ta_totals.invoice_total,
        grand_total=tsi_totals.grand_total + ta_totals.grand_total,
    )

    return PendingDashboardSummaryResponse(
        tsi_groups=tsi_groups,
        ta_groups=ta_groups,
        tsi_totals=tsi_totals,
        ta_totals=ta_totals,
        fleet_totals=fleet_totals,
    )


@router.get("/dashboard-summary/export")
def export_pending_items_dashboard_summary(db: Session = Depends(get_db)) -> StreamingResponse:
    items = _compute_pending_items(db)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items)

    workbook = Workbook()
    sheet_tsi = workbook.active
    sheet_tsi.title = "TSI Pending Summary"
    sheet_ta = workbook.create_sheet(title="TA Pending Summary")

    header_fill = PatternFill("solid", fgColor="0F4C81")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    subtotal_fill = PatternFill("solid", fgColor="F1F5F9")
    subtotal_font = Font(bold=True, color="0F172A", name="Calibri", size=11)
    grand_fill = PatternFill("solid", fgColor="E2E8F0")
    grand_font = Font(bold=True, color="0F4C81", name="Calibri", size=11)

    headers = ["Owner", "Vessel", "Requisitions", "Purchase Orders", "Invoices", "Total Pending"]

    for sheet, groups, totals, role_label in [
        (sheet_tsi, tsi_groups, tsi_totals, "TSI"),
        (sheet_ta, ta_groups, ta_totals, "TA"),
    ]:
        sheet.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = sheet.cell(row=1, column=col_idx)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        current_row = 2
        for g in groups:
            for v in g.vessels:
                sheet.append([g.owner_name, v.vessel_name, v.requisition_count, v.po_count, v.invoice_count, v.total_count])
                current_row += 1
            # Subtotal row
            sub_row = [f"{g.owner_name} Subtotal", "All Assigned Vessels", g.requisition_total, g.po_total, g.invoice_total, g.total_count]
            sheet.append(sub_row)
            for col_idx in range(1, len(headers) + 1):
                c = sheet.cell(row=current_row, column=col_idx)
                c.fill = subtotal_fill
                c.font = subtotal_font
            current_row += 1

        # Grand total row
        grand_row = [f"{role_label} Fleet Total", "All Vessels", totals.requisition_total, totals.po_total, totals.invoice_total, totals.grand_total]
        sheet.append(grand_row)
        for col_idx in range(1, len(headers) + 1):
            c = sheet.cell(row=current_row, column=col_idx)
            c.fill = grand_fill
            c.font = grand_font

        # Adjust column widths
        for col in sheet.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = col[0].column_letter
            sheet.column_dimensions[col_letter].width = max(max_len + 3, 14)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    filename = "TSI_TA_Pending_Dashboard_Summary.xlsx"
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )



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
    ("Title / Description", "title"),
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
    ageing_bracket: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    items = _sorted(
        _filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name, ageing_bracket),
        sort_by,
        sort_dir,
    )

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

    # Frontend always sends stage + optional owner_role (its tab/sub-tab selection), so
    # name the file after them; falls back to a generic name for any other combination.
    stage_clean = [s for s in (stage or []) if s]
    role_clean = [r for r in (owner_role or []) if r and r.upper() != "ALL"]
    if len(stage_clean) == 1 and len(role_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_{role_clean[0]}_Pending.xlsx"
    elif len(stage_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_All_Pending.xlsx"
    else:
        filename = "TSI_TA_Pending_Items.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
