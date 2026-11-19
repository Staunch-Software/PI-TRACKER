import os
from collections import Counter, defaultdict
from datetime import date, datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.hyperlink import Hyperlink
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
    v_clean = [v.strip().upper() for v in vessel_name if v and v.strip()] if isinstance(vessel_name, list) and vessel_name else None
    st_clean = [s.strip().lower() for s in stage if s and s.strip()] if isinstance(stage, list) and stage else None
    or_clean = owner_role if isinstance(owner_role, list) and owner_role else None
    on_clean = [o.strip() for o in owner_name if o and o.strip()] if isinstance(owner_name, list) and owner_name else None

    or_filter: list[str] | None = None
    if or_clean:
        valid_roles = [r.strip().upper() for r in or_clean if r and r.strip().upper() != "ALL"]
        if valid_roles:
            or_filter = valid_roles

    def matches(item: PendingItemOut) -> bool:
        if v_clean and (item.vessel_name or "").strip().upper() not in v_clean:
            return False
        if st_clean and (item.stage or "").strip().lower() not in st_clean:
            return False
        if or_filter and (item.owner_role or "").strip().upper() not in or_filter:
            return False
        if on_clean and (item.owner_name or "").strip() not in on_clean:
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

    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    subtotal_fill = PatternFill("solid", fgColor="F1F5F9")
    subtotal_font = Font(bold=True, color="0F172A", name="Calibri", size=11)
    grand_fill = PatternFill("solid", fgColor="E2E8F0")

    headers = ["Owner", "Vessel", "Requisitions", "Purchase Orders", "Invoices"]

    for sheet, groups, totals, role_label in [
        (sheet_tsi, tsi_groups, tsi_totals, "TSI"),
        (sheet_ta, ta_groups, ta_totals, "TA"),
    ]:
        sheet.append(headers)
        hdr_bg = "0F4C81" if role_label == "TSI" else "581C87"
        h_fill = PatternFill("solid", fgColor=hdr_bg)
        for col_idx in range(1, len(headers) + 1):
            cell = sheet.cell(row=1, column=col_idx)
            cell.fill = h_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

        current_row = 2
        for g in groups:
            for v in g.vessels:
                sheet.append([g.owner_name, v.vessel_name, v.requisition_count, v.po_count, v.invoice_count])
                current_row += 1
            # Subtotal row
            sub_row = [f"{g.owner_name} Subtotal", "All Assigned Vessels", g.requisition_total, g.po_total, g.invoice_total]
            sheet.append(sub_row)
            for col_idx in range(1, len(headers) + 1):
                c = sheet.cell(row=current_row, column=col_idx)
                c.fill = subtotal_fill
                c.font = subtotal_font
            current_row += 1

        # Grand total row
        grand_row = [f"{role_label} Fleet Total", "All Vessels", totals.requisition_total, totals.po_total, totals.invoice_total]
        sheet.append(grand_row)
        g_font = Font(bold=True, color=hdr_bg, name="Calibri", size=11)
        for col_idx in range(1, len(headers) + 1):
            c = sheet.cell(row=current_row, column=col_idx)
            c.fill = grand_fill
            c.font = g_font

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


_BLOCK_COLUMNS: list[tuple[str, int, Alignment]] = [
    ("Sl No.", 8, Alignment(horizontal="center", vertical="center")),
    ("Stage", 16, Alignment(horizontal="center", vertical="center")),
    ("Reference No.", 22, Alignment(horizontal="center", vertical="center")),
    ("Title / Description", 38, Alignment(horizontal="left", vertical="center", wrap_text=True)),
    ("Vendor", 26, Alignment(horizontal="left", vertical="center")),
    ("Status", 16, Alignment(horizontal="center", vertical="center")),
    ("Ageing (Days)", 14, Alignment(horizontal="center", vertical="center")),
    ("Reference Date", 16, Alignment(horizontal="center", vertical="center")),
]


def _build_pending_items_ageing_workbook(
    items: list[PendingItemOut],
    stage_filter: list[str] | None = None,
    role_filter: list[str] | None = None,
    search_filter: str | None = None,
    vessel_filter: list[str] | None = None,
    owner_filter: list[str] | None = None,
    ageing_bracket_filter: str | None = None,
) -> Workbook:
    """Build an interactive, modern standard Excel report (.xlsx) with 5 clean sheets:
    - Sheet 1 ('Ageing Summary'): A comprehensive matrix showing all vessels in rows,
      columns grouped by Ageing (0-30 Days, 30-90 Days, Above 90 Days) with TSI/TA
      separation. All non-zero counts are clickable hyperlinks without ugly underlines.
    - Sheet 2 ('0 - 30 Days'): Items <= 30 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 3 ('30 - 90 Days'): Items 31-90 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 4 ('Above 90 Days'): Critical items > 90 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 5 ('All Details'): Complete fleet items list, organized into dedicated visual cards / blocks per Vessel & In-charge.

    Clicking any cell count in the Summary matrix jumps directly to that specific Vessel & In-charge block!
    """
    workbook = Workbook()

    # ─────────────────────────────────────────────────────────────────────────
    # REFINED MODERN PROFESSIONAL PALETTE (Sophisticated & Harmonious)
    # ─────────────────────────────────────────────────────────────────────────
    NAVY_TOP = "0F2942"          # Deep Maritime Navy
    SLATE_SUBTITLE = "F8FAFC"    # Crisp light slate
    BORDER_LIGHT = "E2E8F0"      # Light slate border
    BORDER_CARD = "CBD5E1"       # Subtle card outline
    ZEBRA_FILL = "F8FAFC"        # Very subtle row alternation

    # Harmonious Header Colors (Balanced, corporate, elegant)
    COLOR_VESSEL_HDR = "1E293B"   # Slate 800 (used for TSI block headers & vessel columns)
    COLOR_VESSEL_SUB = "334155"   # Slate 700 (used for TA block headers & subheaders)
    COLOR_0_30_HDR = "1E3A8A"     # Deep Sapphire Navy
    COLOR_30_90_HDR = "854D0E"    # Refined Warm Bronze / Ochre
    COLOR_90_PLUS_HDR = "831843"  # Refined Deep Wine / Burgundy
    COLOR_TOTAL_HDR = "0F172A"    # Executive Charcoal Navy

    # Subheaders (Tier 2 in Summary)
    COLOR_0_30_SUB = "2563EB"
    COLOR_30_90_SUB = "B45309"
    COLOR_90_PLUS_SUB = "9F1239"
    COLOR_TOTAL_SUB = "1E293B"

    # Number Colors in Data Rows (NO UNDERLINE, Clean and Bold!)
    COLOR_0_30_NUM = "1E3A8A"
    COLOR_30_90_NUM = "854D0E"
    COLOR_90_PLUS_NUM = "831843"
    COLOR_TOTAL_NUM = "0F172A"

    # Soft Badge Colors in Detail Sheets
    PILL_0_30_BG = "EFF6FF"
    PILL_0_30_FG = "1E40AF"
    PILL_30_90_BG = "FEF3C7"
    PILL_30_90_FG = "92400E"
    PILL_90_PLUS_BG = "FCE7F3"
    PILL_90_PLUS_FG = "831843"

    # Fonts (Full 8-char ARGB hex for crisp rendering)
    font_title = Font(name="Calibri", size=14, bold=True, color="FFFFFFFF")
    font_subtitle = Font(name="Calibri", size=9, italic=True, color="FF475569")
    font_tier1 = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
    font_tier2 = Font(name="Calibri", size=9.5, bold=True, color="FFFFFFFF")
    font_vessel_name = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")
    font_incharge = Font(name="Calibri", size=9.5, color="FF475569")
    font_cell_muted = Font(name="Calibri", size=9.5, color="FF94A3B8")
    font_nav_back = Font(name="Calibri", size=9.5, bold=True, color="FFFFFFFF")
    font_detail_data = Font(name="Calibri", size=9.5, color="FF1E293B")
    font_detail_data_bold = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")

    font_block_hdr = Font(name="Calibri", size=11, bold=True, color="FFFFFFFF")
    font_block_subhdr = Font(name="Calibri", size=9, bold=True, color="FFFFFFFF")
    font_block_tot = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")

    # Fills
    fill_title = PatternFill("solid", fgColor=NAVY_TOP)
    fill_subtitle = PatternFill("solid", fgColor=SLATE_SUBTITLE)
    fill_white = PatternFill("solid", fgColor="FFFFFF")
    fill_zebra = PatternFill("solid", fgColor=ZEBRA_FILL)
    fill_grand = PatternFill("solid", fgColor=COLOR_TOTAL_HDR)

    # Borders
    border_cell = Border(
        left=Side(style="thin", color=BORDER_LIGHT),
        right=Side(style="thin", color=BORDER_LIGHT),
        top=Side(style="thin", color=BORDER_LIGHT),
        bottom=Side(style="thin", color=BORDER_LIGHT),
    )
    border_grand = Border(
        left=Side(style="thin", color=COLOR_TOTAL_HDR),
        right=Side(style="thin", color=COLOR_TOTAL_HDR),
        top=Side(style="medium", color=COLOR_TOTAL_HDR),
        bottom=Side(style="double", color=COLOR_TOTAL_HDR),
    )
    border_card = Border(
        left=Side(style="thin", color=BORDER_CARD),
        right=Side(style="thin", color=BORDER_CARD),
        top=Side(style="thin", color=BORDER_CARD),
        bottom=Side(style="thin", color=BORDER_CARD),
    )
    border_block_tot = Border(
        left=Side(style="thin", color=BORDER_CARD),
        right=Side(style="thin", color=BORDER_CARD),
        top=Side(style="thin", color=BORDER_CARD),
        bottom=Side(style="medium", color=COLOR_VESSEL_HDR),
    )

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_text_wrap = Alignment(horizontal="left", vertical="center", wrap_text=True)

    def style_range(ws, min_col: int, min_row: int, max_col: int, max_row: int, fill=None, font=None, alignment=None, border=None):
        for r in range(min_row, max_row + 1):
            for c in range(min_col, max_col + 1):
                cell = ws.cell(row=r, column=c)
                if fill is not None:
                    cell.fill = fill
                if font is not None:
                    cell.font = font
                if alignment is not None:
                    cell.alignment = alignment
                if border is not None:
                    cell.border = border

    def set_link(cell, sheet_name: str, target_coord: str = "A1", font=None):
        cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'{sheet_name}'!{target_coord}")
        if font is not None:
            cell.font = font

    # Classify items into buckets
    def bucket_key(age: int | None) -> str:
        if age is None or age <= 30:
            return "0_30"
        elif age <= 90:
            return "30_90"
        else:
            return "90_plus"

    items_0_30 = [i for i in items if bucket_key(i.ageing_days) == "0_30"]
    items_30_90 = [i for i in items if bucket_key(i.ageing_days) == "30_90"]
    items_90_plus = [i for i in items if bucket_key(i.ageing_days) == "90_plus"]

    # Active vessels list
    if vessel_filter:
        active_vessels = sorted({v.strip().upper() for v in vessel_filter if v.strip()})
    else:
        all_v = set(_VESSEL_OWNERS.keys())
        for itm in items:
            if itm.vessel_name:
                all_v.add(itm.vessel_name.strip().upper())
        active_vessels = sorted(all_v)

    # Subtitle metadata & active filters
    clean_roles = [r.strip().upper() for r in (role_filter or []) if r and r.strip().upper() != "ALL"]
    if clean_roles:
        role_label = f"{clean_roles[0]} Pending"
        role_banner_prefix = f"{clean_roles[0]} PENDING ITEMS"
    else:
        role_label = "All Pending (TSI & TA)"
        role_banner_prefix = "TSI / TA PENDING ITEMS"

    meta_parts: list[str] = []
    if stage_filter:
        meta_parts.append(f"Stage: {', '.join(stage_filter)}")
    meta_parts.append(f"Role: {role_label}")
    if vessel_filter:
        meta_parts.append(f"Vessels: {len(vessel_filter)} selected")
    if owner_filter:
        meta_parts.append(f"Owners: {', '.join(owner_filter)}")
    if ageing_bracket_filter:
        meta_parts.append(f"Bracket: {ageing_bracket_filter}")
    if search_filter:
        meta_parts.append(f"Search: '{search_filter}'")
    meta_parts.append(f"Generated: {datetime.now().strftime('%d-%b-%Y %H:%M')}")
    meta_parts.append(f"Total Pending: {len(items)}")
    subtitle_text = "   |   ".join(meta_parts)

    # For Invoice stage, items have no title/description (title=None). Omit column entirely!
    is_invoice = (
        (stage_filter and len(stage_filter) == 1 and stage_filter[0].strip().lower() == "invoice")
        or (bool(items) and all(i.stage == "Invoice" for i in items))
    )

    if is_invoice:
        block_columns: list[tuple[str, int, Alignment]] = [
            ("Sl No.", 8, align_center),
            ("Stage", 16, align_center),
            ("Reference No.", 24, align_center),
            ("Vendor", 32, align_left),
            ("Status", 18, align_center),
            ("Ageing (Days)", 14, align_center),
            ("Reference Date", 16, align_center),
        ]
    else:
        block_columns: list[tuple[str, int, Alignment]] = [
            ("Sl No.", 8, align_center),
            ("Stage", 16, align_center),
            ("Reference No.", 22, align_center),
            ("Title / Description", 38, align_text_wrap),
            ("Vendor", 26, align_left),
            ("Status", 16, align_center),
            ("Ageing (Days)", 14, align_center),
            ("Reference Date", 16, align_center),
        ]

    num_detail_cols = len(block_columns)

    # ─────────────────────────────────────────────────────────────────────────
    # Function to build detail sheets with DISTINCT VISUAL BLOCKS / CARDS
    # ─────────────────────────────────────────────────────────────────────────
    def build_block_detail_sheet(sheet_title: str, banner_label: str, hdr_color: str, sheet_items: list[PendingItemOut]) -> dict[tuple[str, str], int]:
        ws = workbook.create_sheet(title=sheet_title)
        ws.views.sheetView[0].showGridLines = True

        # Row 1: Return Button & Title
        ws.row_dimensions[1].height = 34
        ws.cell(row=1, column=1, value="⟵ Back to Summary")
        style_range(ws, 1, 1, 1, 1, fill=fill_title, font=font_nav_back, alignment=align_center)
        set_link(ws.cell(row=1, column=1), "Ageing Summary", "A1", font=font_nav_back)

        ws.merge_cells(start_row=1, start_column=2, end_row=1, end_column=num_detail_cols)
        ws.cell(row=1, column=2, value=banner_label)
        style_range(ws, 2, 1, num_detail_cols, 1, fill=PatternFill("solid", fgColor=hdr_color), font=font_title, alignment=align_center)

        # Row 2: Subtitle
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_detail_cols)
        ws.row_dimensions[2].height = 20
        ws.cell(row=2, column=1, value=f"{len(sheet_items)} item(s) in this view   |   Organized by Vessel & In-charge Blocks   |   Click '⟵ Back to Summary' in A1 anytime")
        style_range(ws, 1, 2, num_detail_cols, 2, fill=fill_subtitle, font=font_subtitle, alignment=align_center)

        # Row 3: Gap
        ws.row_dimensions[3].height = 6

        # Set column widths
        for col_idx, (_name, width, _al) in enumerate(block_columns, start=1):
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = width

        # Group sheet_items by (vessel_name, owner_role)
        grouped: dict[str, dict[str, list[PendingItemOut]]] = defaultdict(lambda: defaultdict(list))
        for itm in sheet_items:
            v = (itm.vessel_name or "UNASSIGNED").strip().upper()
            role = (itm.owner_role or "UNASSIGNED").strip().upper()
            grouped[v][role].append(itm)

        # Sort items inside each group by ageing desc
        for v in grouped:
            for role in grouped[v]:
                grouped[v][role].sort(key=lambda x: (-(x.ageing_days if x.ageing_days is not None else -1), x.reference_no or ""))

        # Track row jumps: (vessel, role) -> row, and (vessel, "ALL") -> row
        row_map: dict[tuple[str, str], int] = {}
        curr_r = 4

        if not sheet_items:
            ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols)
            ws.row_dimensions[curr_r].height = 24
            ws.cell(row=curr_r, column=1, value=f"— No pending items match {sheet_title} bracket under current filters —")
            style_range(ws, 1, curr_r, num_detail_cols, curr_r, fill=fill_white, font=font_subtitle, alignment=align_center, border=border_cell)
            curr_r += 1
            ws.freeze_panes = "A4"
            return row_map

        ordered_vessels = list(active_vessels)
        for v in sorted(grouped.keys()):
            if v not in ordered_vessels:
                ordered_vessels.append(v)

        # Build each vessel & in-charge block
        for v_name in ordered_vessels:
            if v_name not in grouped:
                continue

            tsi_name, ta_name = _VESSEL_OWNERS.get(v_name, ("—", "—"))
            roles_order = [("TSI", tsi_name), ("TA", ta_name)]
            for r_extra in grouped[v_name]:
                if r_extra not in ("TSI", "TA"):
                    extra_owner = grouped[v_name][r_extra][0].owner_name if grouped[v_name][r_extra] else "—"
                    roles_order.append((r_extra, extra_owner or "—"))

            for role_key, owner_name in roles_order:
                b_items = grouped[v_name].get(role_key, [])
                if not b_items:
                    continue

                # 1. Block Header Banner (Prominently Highlighted!)
                ws.row_dimensions[curr_r].height = 28
                ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols)
                block_title = f"  ■  {v_name}   |   {role_key} IN-CHARGE: {owner_name}   |   {len(b_items)} Item(s) Pending"
                ws.cell(row=curr_r, column=1, value=block_title)

                # Rich vibrant distinctive highlights: Sapphire Blue for TSI, Royal Amethyst Purple for TA
                if role_key == "TSI":
                    hdr_color = "1E3A8A"
                elif role_key == "TA":
                    hdr_color = "581C87"
                else:
                    hdr_color = "334155"

                hdr_fill = PatternFill("solid", fgColor=hdr_color)
                style_range(ws, 1, curr_r, num_detail_cols, curr_r, fill=hdr_fill, font=font_block_hdr, alignment=align_left)

                # Record coordinate for hyperlinks
                row_map[(v_name, role_key)] = curr_r
                if (v_name, "ALL") not in row_map:
                    row_map[(v_name, "ALL")] = curr_r

                curr_r += 1

                # 2. Block Mini-Table Headers (Dark executive slate for strong contrast with block banner)
                ws.row_dimensions[curr_r].height = 22
                for col_idx, (col_name, _w, _al) in enumerate(block_columns, start=1):
                    c = ws.cell(row=curr_r, column=col_idx, value=col_name)
                    c.fill = PatternFill("solid", fgColor="1E293B")
                    c.font = font_block_subhdr
                    c.alignment = align_center
                    c.border = border_cell
                curr_r += 1

                # 3. Block Data Rows
                for b_idx, itm in enumerate(b_items, start=1):
                    ws.row_dimensions[curr_r].height = 20
                    row_fill = fill_white if b_idx % 2 != 0 else fill_zebra

                    age = itm.ageing_days
                    if age is None or age <= 30:
                        age_pill = PatternFill("solid", fgColor=PILL_0_30_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_0_30_FG)
                    elif age <= 90:
                        age_pill = PatternFill("solid", fgColor=PILL_30_90_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_30_90_FG)
                    else:
                        age_pill = PatternFill("solid", fgColor=PILL_90_PLUS_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_90_PLUS_FG)

                    ref_date_val = itm.reference_date
                    if isinstance(ref_date_val, datetime):
                        ref_date_val = ref_date_val.date()

                    if is_invoice:
                        row_vals = [
                            (b_idx, align_center, font_detail_data_bold, row_fill, None),
                            (itm.stage or "—", align_center, font_detail_data, row_fill, None),
                            (itm.reference_no or "—", align_center, font_detail_data_bold, row_fill, None),
                            (itm.vendor or "—", align_left, font_detail_data, row_fill, None),
                            (itm.status or "—", align_center, font_detail_data, row_fill, None),
                            (f"{itm.ageing_days}d" if itm.ageing_days is not None else "—", align_center, age_font, age_pill, None),
                            (ref_date_val if isinstance(ref_date_val, (date, datetime)) else "—", align_center, font_detail_data, row_fill, "DD-MMM-YYYY" if isinstance(ref_date_val, (date, datetime)) else None),
                        ]
                    else:
                        row_vals = [
                            (b_idx, align_center, font_detail_data_bold, row_fill, None),
                            (itm.stage or "—", align_center, font_detail_data, row_fill, None),
                            (itm.reference_no or "—", align_center, font_detail_data_bold, row_fill, None),
                            (itm.title or "—", align_text_wrap, font_detail_data, row_fill, None),
                            (itm.vendor or "—", align_left, font_detail_data, row_fill, None),
                            (itm.status or "—", align_center, font_detail_data, row_fill, None),
                            (f"{itm.ageing_days}d" if itm.ageing_days is not None else "—", align_center, age_font, age_pill, None),
                            (ref_date_val if isinstance(ref_date_val, (date, datetime)) else "—", align_center, font_detail_data, row_fill, "DD-MMM-YYYY" if isinstance(ref_date_val, (date, datetime)) else None),
                        ]

                    for col_idx, (val, al, fnt, fll, num_fmt) in enumerate(row_vals, start=1):
                        c = ws.cell(row=curr_r, column=col_idx, value=val)
                        c.alignment = al
                        c.font = fnt
                        c.fill = fll
                        c.border = border_cell
                        if num_fmt:
                            c.number_format = num_fmt

                    curr_r += 1

                # 4. Block Subtotal Row
                ws.row_dimensions[curr_r].height = 20
                ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols - 2)
                ws.cell(row=curr_r, column=1, value=f"   Subtotal {v_name} ({role_key} - {owner_name})")
                style_range(ws, 1, curr_r, num_detail_cols - 2, curr_r, fill=PatternFill("solid", fgColor="F1F5F9"), font=font_block_tot, alignment=align_left, border=border_block_tot)

                ws.merge_cells(start_row=curr_r, start_column=num_detail_cols - 1, end_row=curr_r, end_column=num_detail_cols)
                ws.cell(row=curr_r, column=num_detail_cols - 1, value=f"{len(b_items)} item(s)")
                style_range(ws, num_detail_cols - 1, curr_r, num_detail_cols, curr_r, fill=PatternFill("solid", fgColor="F1F5F9"), font=font_block_tot, alignment=align_center, border=border_block_tot)
                curr_r += 1

                # 5. Spacer between blocks (creates the visual card / block feel!)
                ws.row_dimensions[curr_r].height = 12
                curr_r += 1

        # Sheet Grand Total Row
        ws.row_dimensions[curr_r].height = 24
        ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols - 2)
        ws.cell(row=curr_r, column=1, value=f"   TOTAL {sheet_title.upper()} ITEMS")
        style_range(ws, 1, curr_r, num_detail_cols - 2, curr_r, fill=fill_grand, font=font_tier1, alignment=align_left, border=border_grand)

        ws.merge_cells(start_row=curr_r, start_column=num_detail_cols - 1, end_row=curr_r, end_column=num_detail_cols)
        ws.cell(row=curr_r, column=num_detail_cols - 1, value=f"{len(sheet_items)} item(s)")
        style_range(ws, num_detail_cols - 1, curr_r, num_detail_cols, curr_r, fill=fill_grand, font=font_tier1, alignment=align_center, border=border_grand)

        # Freeze panes at row 4 so Rows 1-3 stay pinned at top
        ws.freeze_panes = "A4"

        return row_map

    # Build the 4 detail sheets with distinct block layout and track coordinates
    d_role = clean_roles[0] if clean_roles else None
    all_hdr_color = "1E3A8A" if d_role == "TSI" else ("581C87" if d_role == "TA" else COLOR_TOTAL_HDR)

    map_0_30 = build_block_detail_sheet("0 - 30 Days", f"{role_banner_prefix} — 0 TO 30 DAYS (NORMAL)", "6D28D9" if d_role == "TA" else COLOR_0_30_HDR, items_0_30)
    map_30_90 = build_block_detail_sheet("30 - 90 Days", f"{role_banner_prefix} — 30 TO 90 DAYS (ATTENTION)", COLOR_30_90_HDR, items_30_90)
    map_90_plus = build_block_detail_sheet("Above 90 Days", f"{role_banner_prefix} — ABOVE 90 DAYS (CRITICAL)", COLOR_90_PLUS_HDR, items_90_plus)
    map_all = build_block_detail_sheet("All Details", f"{role_banner_prefix} — ALL DETAILED ITEMS", all_hdr_color, items)

    # ─────────────────────────────────────────────────────────────────────────
    # Sheet 1: The Main Vessel Matrix Summary Table
    # ─────────────────────────────────────────────────────────────────────────
    ws_main = workbook.active
    ws_main.title = "Ageing Summary"
    ws_main.views.sheetView[0].showGridLines = True

    single_role = clean_roles[0] if len(clean_roles) == 1 and clean_roles[0] in ("TSI", "TA") else None
    TOTAL_COLS = 6 if single_role else 15

    # 1. Main Title Banner
    stage_upper = " / ".join(stage_filter).upper() if stage_filter else ""
    if stage_upper and single_role:
        summary_main_title = f"{stage_upper} ({single_role} PENDING) — VESSEL AGEING MATRIX"
    elif stage_upper:
        summary_main_title = f"{stage_upper} (ALL PENDING) — VESSEL AGEING MATRIX"
    elif single_role:
        summary_main_title = f"{single_role} PENDING ITEMS — VESSEL AGEING MATRIX"
    else:
        summary_main_title = "TSI / TA PENDING ITEMS — VESSEL AGEING MATRIX"

    title_bg = "1E3A8A" if single_role == "TSI" else ("581C87" if single_role == "TA" else NAVY_TOP)
    fill_summary_title = PatternFill("solid", fgColor=title_bg)

    ws_main.merge_cells(start_row=1, start_column=1, end_row=1, end_column=TOTAL_COLS)
    ws_main.row_dimensions[1].height = 36
    ws_main.cell(row=1, column=1, value=summary_main_title)
    style_range(ws_main, 1, 1, TOTAL_COLS, 1, fill=fill_summary_title, font=font_title, alignment=align_center)

    # 2. Subtitle Banner
    ws_main.merge_cells(start_row=2, start_column=1, end_row=2, end_column=TOTAL_COLS)
    ws_main.row_dimensions[2].height = 20
    ws_main.cell(row=2, column=1, value=f"{subtitle_text}   |   💡 Click any number to jump directly to that vessel & in-charge block")
    style_range(ws_main, 1, 2, TOTAL_COLS, 2, fill=fill_subtitle, font=font_subtitle, alignment=align_center)

    ws_main.row_dimensions[3].height = 8

    # 3. KPI Summary Cards (Minimalist & Clean)
    ws_main.row_dimensions[4].height = 16
    ws_main.row_dimensions[5].height = 24

    if single_role == "TSI":
        kpi_defs = [
            ("TOTAL TSI PENDING", len(items), "FFFFFF", "1E3A8A", 1, 2, "All Details"),
            ("0 - 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", COLOR_0_30_HDR, 3, 3, "0 - 30 Days"),
            ("30 - 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 4, 4, "30 - 90 Days"),
            ("ABOVE 90 DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 5, 6, "Above 90 Days"),
        ]
    elif single_role == "TA":
        kpi_defs = [
            ("TOTAL TA PENDING", len(items), "FFFFFF", "581C87", 1, 2, "All Details"),
            ("0 - 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", "6D28D9", 3, 3, "0 - 30 Days"),
            ("30 - 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 4, 4, "30 - 90 Days"),
            ("ABOVE 90 DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 5, 6, "Above 90 Days"),
        ]
    else:
        kpi_defs = [
            ("TOTAL FLEET PENDING", len(items), "FFFFFF", COLOR_TOTAL_HDR, 2, 4, "All Details"),
            ("0 - 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", COLOR_0_30_HDR, 5, 7, "0 - 30 Days"),
            ("30 - 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 8, 10, "30 - 90 Days"),
            ("ABOVE 90 DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 11, 13, "Above 90 Days"),
        ]

    for label, count_val, bg_hex, fg_hex, c_start, c_end, target_sheet in kpi_defs:
        if c_end > c_start:
            ws_main.merge_cells(start_row=4, start_column=c_start, end_row=4, end_column=c_end)
        ws_main.cell(row=4, column=c_start, value=label)
        style_range(ws_main, c_start, 4, c_end, 4, fill=PatternFill("solid", fgColor=bg_hex), font=Font(name="Calibri", size=8.5, bold=True, color="FF64748B"), alignment=align_center, border=border_card)

        if c_end > c_start:
            ws_main.merge_cells(start_row=5, start_column=c_start, end_row=5, end_column=c_end)
        c_val = ws_main.cell(row=5, column=c_start, value=count_val)
        f_kpi = Font(name="Calibri", size=14, bold=True, color=f"FF{fg_hex}")
        style_range(ws_main, c_start, 5, c_end, 5, fill=PatternFill("solid", fgColor=bg_hex), font=f_kpi, alignment=align_center, border=border_card)
        set_link(c_val, target_sheet, "A1", font=f_kpi)

    ws_main.row_dimensions[6].height = 12

    # 4. Table Header Tier 1 (Category Banners) — Pure bold white text, NO hyperlinks
    ws_main.row_dimensions[7].height = 28

    if single_role == "TSI":
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 2, "1E293B"),
            ("0 - 30 DAYS (NORMAL)", 3, 3, "1E40AF"),
            ("30 - 90 DAYS (ATTENTION)", 4, 4, "B45309"),
            ("ABOVE 90 DAYS (CRITICAL)", 5, 5, "BE123C"),
            ("TOTAL PENDING", 6, 6, "1E3A8A"),
        ]
    elif single_role == "TA":
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 2, "1E293B"),
            ("0 - 30 DAYS (NORMAL)", 3, 3, "6D28D9"),
            ("30 - 90 DAYS (ATTENTION)", 4, 4, "B45309"),
            ("ABOVE 90 DAYS (CRITICAL)", 5, 5, "BE123C"),
            ("TOTAL PENDING", 6, 6, "581C87"),
        ]
    else:
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 3, "1E293B"),
            ("0 - 30 DAYS (NORMAL)", 4, 6, "1E40AF"),
            ("30 - 90 DAYS (ATTENTION)", 7, 9, "B45309"),
            ("ABOVE 90 DAYS (CRITICAL)", 10, 12, "BE123C"),
            ("TOTAL PENDING", 13, 15, "0F2942"),
        ]

    for title_text, c_start, c_end, color_hex in tier1_groups:
        if c_end > c_start:
            ws_main.merge_cells(start_row=7, start_column=c_start, end_row=7, end_column=c_end)
        ws_main.cell(row=7, column=c_start, value=title_text)
        style_range(
            ws_main,
            c_start,
            7,
            c_end,
            7,
            fill=PatternFill("solid", fgColor=color_hex),
            font=Font(name="Calibri", size=10.5, bold=True, color="FFFFFFFF"),
            alignment=align_center,
            border=border_cell,
        )

    # 5. Table Header Tier 2 (Column Headers) — High-contrast bold white text, NO hyperlinks
    ws_main.row_dimensions[8].height = 24

    if single_role == "TSI":
        tier2_cols = [
            ("Vessel Name", 24, align_left, "1E293B", 9.5),
            ("TSI In-charge", 18, align_center, "1E3A8A", 9.5),
            ("TSI", 16, align_center, "2563EB", 9.5),
            ("TSI", 16, align_center, "D97706", 9.5),
            ("TSI", 16, align_center, "E11D48", 9.5),
            ("TSI Total", 16, align_center, "1E3A8A", 9.5),
        ]
    elif single_role == "TA":
        tier2_cols = [
            ("Vessel Name", 24, align_left, "1E293B", 9.5),
            ("TA In-charge", 18, align_center, "581C87", 9.5),
            ("TA", 16, align_center, "7C3AED", 9.5),
            ("TA", 16, align_center, "D97706", 9.5),
            ("TA", 16, align_center, "E11D48", 9.5),
            ("TA Total", 16, align_center, "581C87", 9.5),
        ]
    else:
        tier2_cols = [
            ("Vessel Name", 22, align_left, "1E293B", 9.5),
            ("TSI In-charge", 16, align_center, "1E3A8A", 9.5),
            ("TA In-charge", 16, align_center, "581C87", 9.5),
            ("TSI", 10, align_center, "2563EB", 9.5),
            ("TA", 10, align_center, "7C3AED", 9.5),
            ("Total", 11, align_center, "1D4ED8", 9.5),
            ("TSI", 10, align_center, "D97706", 9.5),
            ("TA", 10, align_center, "8B5CF6", 9.5),
            ("Total", 11, align_center, "B45309", 9.5),
            ("TSI", 10, align_center, "E11D48", 9.5),
            ("TA", 10, align_center, "C026D3", 9.5),
            ("Total", 11, align_center, "BE123C", 9.5),
            ("TSI Total", 12, align_center, "1E3A8A", 9.5),
            ("TA Total", 12, align_center, "581C87", 9.5),
            ("Fleet Total", 13, align_center, "0F172A", 10.0),
        ]

    for col_idx, (col_name, width, al, bg_hex, f_size) in enumerate(tier2_cols, start=1):
        cell = ws_main.cell(row=8, column=col_idx, value=col_name)
        cell.fill = PatternFill("solid", fgColor=bg_hex)
        cell.font = Font(name="Calibri", size=f_size, bold=True, color="FFFFFFFF")
        cell.alignment = align_center
        cell.border = border_cell
        col_letter = get_column_letter(col_idx)
        ws_main.column_dimensions[col_letter].width = width

    # Organize counts per vessel for summary table
    vessel_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for item in items:
        v = (item.vessel_name or "").strip().upper()
        b = bucket_key(item.ageing_days)
        role = (item.owner_role or "").strip().upper()
        if role in ("TSI", "TA"):
            vessel_counts[v][f"{b}_{role.lower()}"] += 1
            vessel_counts[v][f"{b}_tot"] += 1
            vessel_counts[v][f"tot_{role.lower()}"] += 1
            vessel_counts[v]["tot_all"] += 1

    # 6. Data Rows (Vessels)
    curr_row = 9
    fleet_sums = defaultdict(int)

    for idx, v_name in enumerate(active_vessels, start=1):
        ws_main.row_dimensions[curr_row].height = 21
        row_fill = fill_white if idx % 2 != 0 else fill_zebra

        tsi_incharge, ta_incharge = _VESSEL_OWNERS.get(v_name, ("—", "—"))
        vc = vessel_counts[v_name]

        c_0_30_tsi = vc["0_30_tsi"]
        c_0_30_ta = vc["0_30_ta"]
        c_0_30_tot = vc["0_30_tot"]

        c_30_90_tsi = vc["30_90_tsi"]
        c_30_90_ta = vc["30_90_ta"]
        c_30_90_tot = vc["30_90_tot"]

        c_90_tsi = vc["90_plus_tsi"]
        c_90_ta = vc["90_plus_ta"]
        c_90_tot = vc["90_plus_tot"]

        c_tot_tsi = vc["tot_tsi"]
        c_tot_ta = vc["tot_ta"]
        c_tot_all = vc["tot_all"]

        fleet_sums["0_30_tsi"] += c_0_30_tsi
        fleet_sums["0_30_ta"] += c_0_30_ta
        fleet_sums["0_30_tot"] += c_0_30_tot

        fleet_sums["30_90_tsi"] += c_30_90_tsi
        fleet_sums["30_90_ta"] += c_30_90_ta
        fleet_sums["30_90_tot"] += c_30_90_tot

        fleet_sums["90_plus_tsi"] += c_90_tsi
        fleet_sums["90_plus_ta"] += c_90_ta
        fleet_sums["90_plus_tot"] += c_90_tot

        fleet_sums["tot_tsi"] += c_tot_tsi
        fleet_sums["tot_ta"] += c_tot_ta
        fleet_sums["tot_all"] += c_tot_all

        # Determine exact row coordinates in detail sheets
        r_0_30_tsi = map_0_30.get((v_name, "TSI"))
        r_0_30_ta = map_0_30.get((v_name, "TA"))
        r_0_30_all = map_0_30.get((v_name, "ALL"))

        r_30_90_tsi = map_30_90.get((v_name, "TSI"))
        r_30_90_ta = map_30_90.get((v_name, "TA"))
        r_30_90_all = map_30_90.get((v_name, "ALL"))

        r_90_tsi = map_90_plus.get((v_name, "TSI"))
        r_90_ta = map_90_plus.get((v_name, "TA"))
        r_90_all = map_90_plus.get((v_name, "ALL"))

        r_all_tsi = map_all.get((v_name, "TSI"))
        r_all_ta = map_all.get((v_name, "TA"))
        r_all_all = map_all.get((v_name, "ALL"))

        target_row_for_vessel = r_all_tsi if single_role == "TSI" else (r_all_ta if single_role == "TA" else r_all_all)

        # Vessel name cell (links to that vessel's block in All Details) — Prominently bold
        v_cell = ws_main.cell(row=curr_row, column=1, value=v_name)
        v_cell.font = Font(name="Calibri", size=10, bold=True, color="FF0F172A")
        v_cell.alignment = align_left
        v_cell.fill = row_fill
        v_cell.border = border_cell
        if target_row_for_vessel:
            set_link(v_cell, "All Details", f"A{target_row_for_vessel}", font=Font(name="Calibri", size=10, bold=True, color="FF0F172A"))

        if single_role == "TSI":
            # TSI In-charge (Col 2)
            cell_tsi = ws_main.cell(row=curr_row, column=2, value=tsi_incharge)
            cell_tsi.font = Font(name="Calibri", size=9.5, bold=True, color="FF1E40AF")
            cell_tsi.alignment = align_center
            cell_tsi.fill = row_fill
            cell_tsi.border = border_cell

            count_mappings = [
                (3, c_0_30_tsi, COLOR_0_30_NUM, "0 - 30 Days", f"A{r_0_30_tsi}" if r_0_30_tsi else None),
                (4, c_30_90_tsi, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_tsi}" if r_30_90_tsi else None),
                (5, c_90_tsi, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_tsi}" if r_90_tsi else None),
                (6, c_tot_tsi, COLOR_TOTAL_NUM, "All Details", f"A{r_all_tsi}" if r_all_tsi else None),
            ]
        elif single_role == "TA":
            # TA In-charge (Col 2)
            cell_ta = ws_main.cell(row=curr_row, column=2, value=ta_incharge)
            cell_ta.font = Font(name="Calibri", size=9.5, bold=True, color="FF6D28D9")
            cell_ta.alignment = align_center
            cell_ta.fill = row_fill
            cell_ta.border = border_cell

            count_mappings = [
                (3, c_0_30_ta, "6D28D9", "0 - 30 Days", f"A{r_0_30_ta}" if r_0_30_ta else None),
                (4, c_30_90_ta, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_ta}" if r_30_90_ta else None),
                (5, c_90_ta, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_ta}" if r_90_ta else None),
                (6, c_tot_ta, "581C87", "All Details", f"A{r_all_ta}" if r_all_ta else None),
            ]
        else:
            # Full 15-column matrix
            # TSI In-charge (Col 2)
            cell_tsi = ws_main.cell(row=curr_row, column=2, value=tsi_incharge)
            cell_tsi.font = Font(name="Calibri", size=9.5, bold=True, color="FF1E40AF")
            cell_tsi.alignment = align_center
            cell_tsi.fill = row_fill
            cell_tsi.border = border_cell

            # TA In-charge (Col 3)
            cell_ta = ws_main.cell(row=curr_row, column=3, value=ta_incharge)
            cell_ta.font = Font(name="Calibri", size=9.5, bold=True, color="FF6D28D9")
            cell_ta.alignment = align_center
            cell_ta.fill = row_fill
            cell_ta.border = border_cell

            count_mappings = [
                (4, c_0_30_tsi, COLOR_0_30_NUM, "0 - 30 Days", f"A{r_0_30_tsi}" if r_0_30_tsi else None),
                (5, c_0_30_ta, "6D28D9", "0 - 30 Days", f"A{r_0_30_ta}" if r_0_30_ta else None),
                (6, c_0_30_tot, COLOR_0_30_NUM, "0 - 30 Days", f"A{r_0_30_all}" if r_0_30_all else None),

                (7, c_30_90_tsi, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_tsi}" if r_30_90_tsi else None),
                (8, c_30_90_ta, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_ta}" if r_30_90_ta else None),
                (9, c_30_90_tot, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_all}" if r_30_90_all else None),

                (10, c_90_tsi, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_tsi}" if r_90_tsi else None),
                (11, c_90_ta, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_ta}" if r_90_ta else None),
                (12, c_90_tot, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_all}" if r_90_all else None),

                (13, c_tot_tsi, "1E3A8A", "All Details", f"A{r_all_tsi}" if r_all_tsi else None),
                (14, c_tot_ta, "581C87", "All Details", f"A{r_all_ta}" if r_all_ta else None),
                (15, c_tot_all, COLOR_TOTAL_NUM, "All Details", f"A{r_all_all}" if r_all_all else None),
            ]

        for col_idx, cnt, num_color, tgt_sheet, tgt_coord in count_mappings:
            cell = ws_main.cell(row=curr_row, column=col_idx)
            cell.alignment = align_center
            cell.fill = row_fill
            cell.border = border_cell

            if cnt == 0:
                cell.value = "—"
                cell.font = font_cell_muted
            else:
                cell.value = cnt
                # NO UNDERLINE! Clean, bold, elegant number!
                f_num = Font(name="Calibri", size=10, bold=True, color=f"FF{num_color}")
                cell.font = f_num

                if tgt_sheet and tgt_coord:
                    set_link(cell, tgt_sheet, tgt_coord, font=f_num)

        curr_row += 1

    # 7. Bottom Fleet Total Row — High-contrast bold white text, NO hyperlinks
    label_cols = 2 if single_role else 3
    ws_main.merge_cells(start_row=curr_row, start_column=1, end_row=curr_row, end_column=label_cols)
    ws_main.row_dimensions[curr_row].height = 26
    ws_main.cell(row=curr_row, column=1, value="   FLEET GRAND TOTAL")
    fleet_grand_bg = "1E3A8A" if single_role == "TSI" else ("581C87" if single_role == "TA" else COLOR_TOTAL_HDR)
    fill_fleet_grand = PatternFill("solid", fgColor=fleet_grand_bg)
    border_fleet_grand = Border(
        left=Side(style="thin", color=fleet_grand_bg),
        right=Side(style="thin", color=fleet_grand_bg),
        top=Side(style="medium", color=fleet_grand_bg),
        bottom=Side(style="double", color=fleet_grand_bg),
    )
    style_range(ws_main, 1, curr_row, label_cols, curr_row, fill=fill_fleet_grand, font=Font(name="Calibri", size=10, bold=True, color="FFFFFFFF"), alignment=align_left, border=border_fleet_grand)

    if single_role == "TSI":
        fleet_col_map = [
            (3, fleet_sums["0_30_tsi"]),
            (4, fleet_sums["30_90_tsi"]),
            (5, fleet_sums["90_plus_tsi"]),
            (6, fleet_sums["tot_tsi"]),
        ]
    elif single_role == "TA":
        fleet_col_map = [
            (3, fleet_sums["0_30_ta"]),
            (4, fleet_sums["30_90_ta"]),
            (5, fleet_sums["90_plus_ta"]),
            (6, fleet_sums["tot_ta"]),
        ]
    else:
        fleet_col_map = [
            (4, fleet_sums["0_30_tsi"]),
            (5, fleet_sums["0_30_ta"]),
            (6, fleet_sums["0_30_tot"]),
            (7, fleet_sums["30_90_tsi"]),
            (8, fleet_sums["30_90_ta"]),
            (9, fleet_sums["30_90_tot"]),
            (10, fleet_sums["90_plus_tsi"]),
            (11, fleet_sums["90_plus_ta"]),
            (12, fleet_sums["90_plus_tot"]),
            (13, fleet_sums["tot_tsi"]),
            (14, fleet_sums["tot_ta"]),
            (15, fleet_sums["tot_all"]),
        ]

    for col_idx, tot_val in fleet_col_map:
        cell = ws_main.cell(row=curr_row, column=col_idx, value=tot_val)
        cell.fill = fill_fleet_grand
        cell.font = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
        cell.alignment = align_center
        cell.border = border_fleet_grand

    # Freeze panes on summary sheet at row 9 so headers stay locked
    ws_main.freeze_panes = "A9"

    # Ensure Ageing Summary is active tab when opened
    workbook.active = ws_main

    return workbook


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

    workbook = _build_pending_items_ageing_workbook(
        items=items,
        stage_filter=stage,
        role_filter=owner_role,
        search_filter=search,
        vessel_filter=vessel_name,
        owner_filter=owner_name,
        ageing_bracket_filter=ageing_bracket,
    )

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    # Frontend sends stage + optional owner_role (its tab/sub-tab selection), so
    # name the file after them; falls back to a generic name for any other combination.
    stage_clean = [s for s in (stage or []) if s]
    role_clean = [r.strip().upper() for r in (owner_role or []) if r and r.strip().upper() != "ALL"]
    if len(stage_clean) == 1 and len(role_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_{role_clean[0]}_Pending_Ageing.xlsx"
    elif len(stage_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_All_Pending_Ageing.xlsx"
    elif len(role_clean) == 1:
        filename = f"Fleet_{role_clean[0]}_Pending_Ageing.xlsx"
    else:
        filename = "Fleet_All_Pending_Ageing.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
