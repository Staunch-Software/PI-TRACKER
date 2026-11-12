import uuid
from datetime import date, datetime, timedelta
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Query as OrmQuery
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from decimal import Decimal
from fastapi import BackgroundTasks
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.po_item_entry import PoItemEntry
from app.models.pr_entry import PrEntry
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.models.user import User
from app.schemas.common import PaginatedResult
from app.schemas.dd_tracker import (
    AccountCodeAnalysisResponse,
    AccountCodeGroup,
    AccountCodeSpendForPo,
    PoSpendForAccountCode,
    DdTrackerBulkDeleteRequest,
    DdTrackerBulkDeleteResult,
    DdTrackerEntryCreate,
    DdTrackerEntryOut,
    DdTrackerEntryUpdate,
    DdTrackerFilterOptions,
    PoAccountGroup,
    PoItemDetailOut,
    PoLookupResult,
    PrLookupResult,
    SyncPoItemsRequest,
    SyncPoItemsResponse,
)
from app.services.po_scraper.scraper import scrape_dd_po_items

# Module-level gate (can_access_dd, Admin always passes) on every route; writes additionally
# need Admin/Editor, same stance as every other module in this app.
router = APIRouter(
    prefix="/dd-tracker",
    tags=["dd-tracker"],
    dependencies=[Depends(require_module_access("dd"))],
)

_writers = require_roles(UserRole.ADMIN, UserRole.EDITOR)

_SORTABLE_COLUMNS = {
    "seqNo": DdTrackerEntry.seq_no,
    "entryType": DdTrackerEntry.entry_type,
    "vesselName": DdTrackerEntry.vessel_name,
    "requisitionNo": DdTrackerEntry.requisition_no,
    "poNo": DdTrackerEntry.po_no,
    "readinessDate": DdTrackerEntry.readiness_date,
}


def _effective_pr_status(pr: PrEntry | None) -> str | None:
    """pr.status is SmartPAL's workflow-STAGE text ("RFQ Created", "Requisition Approved", …) and
    does NOT get reset when a requisition is later rejected or cancelled — confirmed live
    2026-11-03, a requisition cancelled right after approval still showed status "Requisition
    Approved" forever. pr.approval_flag is the field that actually reflects that terminal state
    (Approved / Finally Approved / Pending / Rejected / Cancelled), so it takes precedence here
    whenever it says the requisition is dead."""
    if not pr:
        return None
    if pr.approval_flag in ("Cancelled", "Rejected"):
        return pr.approval_flag
    return pr.status


def _effective_readiness_date(entry: DdTrackerEntry, po: PoEntry | None) -> date | None:
    """Readiness Date defaults to the PO's own expected_delivery_date (SmartPAL's "Scheduled
    Delivery Date") when the team hasn't typed one in — confirmed with the user 2026-11-04 — but
    an explicit entry.readiness_date always wins, same "live value, optional override" pattern as
    po_schd_del_port/supply_port below. Never writes back to entry.readiness_date; purely a display
    /computation fallback, so editing the cell still only ever touches the override."""
    return entry.readiness_date or (po.expected_delivery_date if po else None)


def _to_out(
    entry: DdTrackerEntry, pr: PrEntry | None, po: PoEntry | None, invoice: SmartpalInvoiceEntry | None
) -> DdTrackerEntryOut:
    return DdTrackerEntryOut(
        id=entry.id,
        seq_no=entry.seq_no,
        entry_type=entry.entry_type,
        requisition_no=entry.requisition_no,
        po_no=entry.po_no,
        vessel_name=entry.vessel_name,
        title=entry.title,
        pr_status=entry.pr_status,
        order_status=entry.order_status,
        readiness_date=_effective_readiness_date(entry, po),
        ex_stock=entry.ex_stock,
        supply_confirmation=entry.supply_confirmation,
        remarks=entry.remarks,
        invoice_type=entry.invoice_type,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        pr_title=pr.title if pr else None,
        pr_status_live=_effective_pr_status(pr),
        pr_department=pr.department if pr else None,
        pr_req_category=pr.req_category if pr else None,
        po_title=po.title if po else None,
        po_vendor=po.vendor if po else None,
        po_req_category=po.req_category if po else None,
        po_approved_status=po.approved_status if po else None,
        po_invoice_status=po.invoice_status if po else None,
        po_base_amount=po.base_amount if po else None,
        po_base_currency=po.base_currency if po else None,
        po_confirmed_date=po.approved_date if po else None,
        po_schd_del_port=entry.supply_port or (po.schd_del_port if po else None),
        po_agent_name=po.agent_name if po else None,
        po_warehouse_name=po.warehouse_name if po else None,
        po_grn_nos=po.grn_nos if po else None,
        po_do_nos=po.do_nos if po else None,
        invoice_number=invoice.invoice_no if invoice else None,
        invoice_amount=invoice.amount if invoice else None,
        invoice_currency=invoice.currency_code if invoice else None,
        invoice_status=invoice.status if invoice else None,
        payment_status=_compute_payment_status(invoice),
        lead_days=_compute_lead_days(entry, po),
    )


def _compute_payment_status(invoice: SmartpalInvoiceEntry | None) -> str | None:
    """Live from smartpal_invoice_entries.paid_status (SmartPAL's own "paidStatus" field —
    confirmed live 2026-10-30 it only ever carries 'PAID' or null/not-set, no other values) rather
    than the manual field this column used to be — see dd_tracker_entry.py docstring. None when no
    invoice has been raised against this PO yet (distinct from "raised but not paid")."""
    if invoice is None:
        return None
    return "Paid" if invoice.paid_status == "PAID" else "Not Paid"


def _compute_lead_days(entry: DdTrackerEntry, po: PoEntry | None) -> int | None:
    """Vendor's actual lead time — days between the PO being acknowledged and the item being
    ready — confirmed with the user 2026-10-29 as the intended meaning of "Lead Days" (previously
    a manual number). Uses po.approved_date, NOT po.confirmed_date: confirmed live 2026-10-29 that
    SmartPAL's confirmedDate field is null on every single PO scraped so far (0 of 2378) — it
    looked like the obvious "acknowledged" field name-wise, but carries no real data, whereas
    approvedDate is populated on 100% of rows and genuinely differs from createdDate/effectiveDate
    on ~88% of them (not just a rubber-stamped duplicate). po_confirmed_date in the API response
    (the wire field "PO Acknowledged date" already used) was repointed at po.approved_date to
    match, rather than introducing a new field name. None whenever either date is missing.
    Uses the same live-or-override readiness date _effective_readiness_date computes, so Lead
    Days stays consistent with whatever Readiness Date the row is actually displaying."""
    readiness = _effective_readiness_date(entry, po)
    if not readiness or not po or not po.approved_date:
        return None
    return (readiness - po.approved_date).days


def _fetch_live(db: Session, entry: DdTrackerEntry) -> tuple[PrEntry | None, PoEntry | None, SmartpalInvoiceEntry | None]:
    pr = db.query(PrEntry).filter(PrEntry.requisition_no == entry.requisition_no).first() if entry.requisition_no else None
    po = db.query(PoEntry).filter(PoEntry.po_no == entry.po_no).first() if entry.po_no else None
    invoice = (
        db.query(SmartpalInvoiceEntry)
        .filter(SmartpalInvoiceEntry.po_nos == entry.po_no)
        .order_by(SmartpalInvoiceEntry.last_scraped_at.desc())
        .first()
        if entry.po_no
        else None
    )
    return pr, po, invoice


def _filtered_query(
    db: Session,
    search: str | None,
    entry_type: list[str] | None,
    vessel_name: list[str] | None,
    sort_by: str | None,
    sort_dir: str,
    requisition_no: str | None = None,
    po_no: str | None = None,
    readiness_date_from: date | None = None,
    readiness_date_to: date | None = None,
    exclude_entry_types: list[str] | None = None,
) -> OrmQuery:
    query = db.query(DdTrackerEntry).filter(DdTrackerEntry.deleted_at.is_(None))
    # Hard, non-optional partition between tracker pages that share this table — added 2026-11-12
    # after confirming live that a PD Tracker row (entry_type='PD') otherwise still showed up in
    # DD Tracker's own unfiltered list too. dd_tracker.py's own calls always pass
    # exclude_entry_types=["PD"] here (preserving the 34 pre-existing OPEX rows DD Tracker already
    # showed, unlike forcing entry_type=='DD' outright would); pd_tracker.py doesn't need this at
    # all since its own entry_type filter is already forced to exactly ["PD"].
    if exclude_entry_types:
        query = query.filter(or_(DdTrackerEntry.entry_type.is_(None), DdTrackerEntry.entry_type.notin_(exclude_entry_types)))

    s_clean = search.strip() if isinstance(search, str) and search.strip() else None
    if s_clean:
        escaped = s_clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            or_(
                *[
                    column.ilike(pattern, escape="\\")
                    for column in (
                        cast(DdTrackerEntry.seq_no, String),
                        DdTrackerEntry.requisition_no,
                        DdTrackerEntry.po_no,
                        DdTrackerEntry.vessel_name,
                        DdTrackerEntry.title,
                        DdTrackerEntry.pr_status,
                        DdTrackerEntry.order_status,
                        DdTrackerEntry.remarks,
                    )
                ]
            )
        )
    e_clean = [entry_type] if isinstance(entry_type, str) else entry_type if isinstance(entry_type, (list, tuple)) and entry_type else None
    if e_clean:
        query = query.filter(DdTrackerEntry.entry_type.in_(e_clean))
    v_clean = [vessel_name] if isinstance(vessel_name, str) else vessel_name if isinstance(vessel_name, (list, tuple)) and vessel_name else None
    if v_clean:
        query = query.filter(DdTrackerEntry.vessel_name.in_(v_clean))

    # Per-column Excel-style filters, added 2026-11-11 alongside the matching column-header sort —
    # deliberately scoped to the same columns _SORTABLE_COLUMNS already covers (plain
    # DdTrackerEntry fields), not the PR/PO/invoice columns that only ever get joined in Python
    # after this query runs (see _attach_live_data) — confirmed with the user as out of scope here.
    rn_clean = requisition_no.strip() if isinstance(requisition_no, str) and requisition_no.strip() else None
    if rn_clean:
        escaped = rn_clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(DdTrackerEntry.requisition_no.ilike(f"%{escaped}%", escape="\\"))
    pn_clean = po_no.strip() if isinstance(po_no, str) and po_no.strip() else None
    if pn_clean:
        escaped = pn_clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(DdTrackerEntry.po_no.ilike(f"%{escaped}%", escape="\\"))
    if readiness_date_from:
        query = query.filter(DdTrackerEntry.readiness_date >= readiness_date_from)
    if readiness_date_to:
        query = query.filter(DdTrackerEntry.readiness_date < (readiness_date_to + timedelta(days=1)))

    sort_column = _SORTABLE_COLUMNS.get(sort_by) if sort_by else None
    if sort_column is not None:
        ordered = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        return query.order_by(ordered.nulls_last(), DdTrackerEntry.seq_no.asc())
    return query.order_by(DdTrackerEntry.seq_no.asc())


class _LiveFilters:
    """Excel-style filters for the columns computed live in _attach_live_data (PR Status, PO
    Status, Vendor, Invoice Status, Payment Status) plus a few plain DdTrackerEntry columns that
    weren't in the first round (Supply Port, Order Status, Delivery Status, Remarks, Invoice
    Type) — added 2026-11-11 per direct purchaser feedback relayed by the user. These can't be
    pushed into _filtered_query's SQL WHERE clause the way requisition_no/po_no are: PR Status/PO
    Status/Vendor/Invoice Status/Payment Status only exist after the PR/PO/Invoice join in
    _attach_live_data runs, and Supply Port/Readiness Date already follow the same "live value,
    optional override" pattern (po.schd_del_port when entry.supply_port is blank) rather than
    being pure DB columns either. So filtering (and therefore counting/paginating) can only happen
    AFTER _attach_live_data, on the enriched DdTrackerEntryOut list — see
    _filter_and_paginate_enriched below, which fetches every row matching the cheap SQL-level
    filters first, then applies these here before slicing the page."""

    def __init__(
        self,
        pr_status: list[str] | None,
        po_status: list[str] | None,
        vendor: list[str] | None,
        supply_port: str | None,
        order_status: list[str] | None,
        delivery_status: list[str] | None,
        remarks: str | None,
        invoice_type: list[str] | None,
        invoice_status: list[str] | None,
        payment_status: list[str] | None,
    ):
        def _clean_list(v: list[str] | str | None) -> list[str] | None:
            if isinstance(v, str):
                return [v] if v else None
            if isinstance(v, (list, tuple)) and v:
                return list(v)
            return None

        def _clean_text(v: str | None) -> str | None:
            return v.strip() if isinstance(v, str) and v.strip() else None

        self.pr_status = _clean_list(pr_status)
        self.po_status = _clean_list(po_status)
        self.vendor = _clean_list(vendor)
        self.supply_port = _clean_text(supply_port)
        self.order_status = _clean_list(order_status)
        self.delivery_status = _clean_list(delivery_status)
        self.remarks = _clean_text(remarks)
        self.invoice_type = _clean_list(invoice_type)
        self.invoice_status = _clean_list(invoice_status)
        self.payment_status = _clean_list(payment_status)

    def is_empty(self) -> bool:
        return not any(
            (
                self.pr_status, self.po_status, self.vendor, self.supply_port, self.order_status,
                self.delivery_status, self.remarks, self.invoice_type, self.invoice_status, self.payment_status,
            )
        )

    def matches(self, item: DdTrackerEntryOut) -> bool:
        if self.pr_status and item.pr_status_live not in self.pr_status:
            return False
        if self.po_status and item.po_approved_status not in self.po_status:
            return False
        if self.vendor and item.po_vendor not in self.vendor:
            return False
        if self.supply_port and self.supply_port.lower() not in (item.po_schd_del_port or "").lower():
            return False
        if self.order_status and item.order_status not in self.order_status:
            return False
        if self.delivery_status and item.supply_confirmation not in self.delivery_status:
            return False
        if self.remarks and self.remarks.lower() not in (item.remarks or "").lower():
            return False
        if self.invoice_type and item.invoice_type not in self.invoice_type:
            return False
        if self.invoice_status and item.invoice_status not in self.invoice_status:
            return False
        if self.payment_status and item.payment_status not in self.payment_status:
            return False
        return True


def _filter_and_paginate_enriched(
    db: Session,
    query: OrmQuery,
    live_filters: "_LiveFilters",
    page: int | None,
    page_size: int | None,
) -> tuple[list[DdTrackerEntryOut], int]:
    """Runs the (unpaginated) SQL-level query, enriches every matching row with live PR/PO/invoice
    data, applies the live-field filters, and only THEN paginates — see _LiveFilters' docstring
    for why this can't happen at the SQL level. page=None returns every filtered row (export)."""
    enriched = _attach_live_data(db, query.all())
    if not live_filters.is_empty():
        enriched = [item for item in enriched if live_filters.matches(item)]
    total = len(enriched)
    if page is None or page_size is None:
        return enriched, total
    start = (page - 1) * page_size
    return enriched[start : start + page_size], total


def _attach_live_data(db: Session, entries: list[DdTrackerEntry]) -> list[DdTrackerEntryOut]:
    req_nos = {e.requisition_no for e in entries if e.requisition_no}
    po_nos = {e.po_no for e in entries if e.po_no}
    prs = {p.requisition_no: p for p in db.query(PrEntry).filter(PrEntry.requisition_no.in_(req_nos)).all()} if req_nos else {}
    pos = {p.po_no: p for p in db.query(PoEntry).filter(PoEntry.po_no.in_(po_nos)).all()} if po_nos else {}

    # smartpal_invoice_entries.po_nos is an exact-match string (every row sampled live 2026-10-28
    # carried exactly one PO number, never a real comma-separated list despite the plural SmartPAL
    # field name) — same assumption po_entries.requisition_no already makes. A PO with more than
    # one invoice (partial invoicing) keeps whichever was scraped most recently.
    invoices: dict[str, SmartpalInvoiceEntry] = {}
    if po_nos:
        rows = (
            db.query(SmartpalInvoiceEntry)
            .filter(SmartpalInvoiceEntry.po_nos.in_(po_nos))
            .order_by(SmartpalInvoiceEntry.last_scraped_at.desc())
            .all()
        )
        for inv in rows:
            invoices.setdefault(inv.po_nos, inv)

    return [_to_out(e, prs.get(e.requisition_no), pos.get(e.po_no), invoices.get(e.po_no)) for e in entries]


@router.get("", response_model=PaginatedResult[DdTrackerEntryOut])
def list_dd_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    entry_type: list[str] | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    requisition_no: str | None = Query(default=None),
    po_no: str | None = Query(default=None),
    readiness_date_from: date | None = Query(default=None),
    readiness_date_to: date | None = Query(default=None),
    pr_status: list[str] | None = Query(default=None),
    po_status: list[str] | None = Query(default=None),
    vendor: list[str] | None = Query(default=None),
    supply_port: str | None = Query(default=None),
    order_status: list[str] | None = Query(default=None),
    delivery_status: list[str] | None = Query(default=None),
    remarks: str | None = Query(default=None),
    invoice_type: list[str] | None = Query(default=None),
    invoice_status: list[str] | None = Query(default=None),
    payment_status: list[str] | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[DdTrackerEntryOut]:
    query = _filtered_query(
        db, search, entry_type, vessel_name, sort_by, sort_dir,
        requisition_no, po_no, readiness_date_from, readiness_date_to,
        exclude_entry_types=["PD"],
    )
    live_filters = _LiveFilters(
        pr_status, po_status, vendor, supply_port, order_status,
        delivery_status, remarks, invoice_type, invoice_status, payment_status,
    )
    items, total = _filter_and_paginate_enriched(db, query, live_filters, page, page_size)
    return PaginatedResult[DdTrackerEntryOut](items=items, total=total, page=page, page_size=page_size)


# Column order/labels mirror DdTrackerTable.tsx's DEFAULT_COLUMN_ORDER (frontend) so the exported
# file reads the same as what's on screen. Vessel isn't a table column there (filtered via the
# capsule row instead) but is included here since the file stands alone once downloaded.
_EXPORT_COLUMNS: list[tuple[str, str]] = [
    ("S.No.", "seq_no"),
    ("Type", "entry_type"),
    ("Title", "title"),
    ("Vessel", "vessel_name"),
    ("PR Number", "requisition_no"),
    ("PR Status", "pr_status_live"),
    ("PO Number", "po_no"),
    ("PO Status", "po_approved_status"),
    ("Vendor", "po_vendor"),
    ("PO Amount", "po_base_amount"),
    ("PO Currency", "po_base_currency"),
    ("Supply Port", "po_schd_del_port"),
    ("Order Status", "order_status"),
    ("Lead Days", "lead_days"),
    ("Readiness Date", "readiness_date"),
    ("Ex-Stock", "ex_stock"),
    ("Delivery Status", "supply_confirmation"),
    ("Remarks", "remarks"),
    ("Invoice Number", "invoice_number"),
    ("Invoice Type", "invoice_type"),
    ("Invoice Amount", "invoice_amount"),
    ("Invoice Currency", "invoice_currency"),
    ("Invoice Status", "invoice_status"),
    ("Payment Status", "payment_status"),
]


@router.get("/export")
def export_dd_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    entry_type: list[str] | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    requisition_no: str | None = Query(default=None),
    po_no: str | None = Query(default=None),
    readiness_date_from: date | None = Query(default=None),
    readiness_date_to: date | None = Query(default=None),
    pr_status: list[str] | None = Query(default=None),
    po_status: list[str] | None = Query(default=None),
    vendor: list[str] | None = Query(default=None),
    supply_port: str | None = Query(default=None),
    order_status: list[str] | None = Query(default=None),
    delivery_status: list[str] | None = Query(default=None),
    remarks: str | None = Query(default=None),
    invoice_type: list[str] | None = Query(default=None),
    invoice_status: list[str] | None = Query(default=None),
    payment_status: list[str] | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    """Exports every row matching the current "By PO" filters (no pagination) as an .xlsx
    workbook — same filter params the list endpoint takes, so "export" always means "export
    exactly what's on screen right now"."""
    query = _filtered_query(
        db, search, entry_type, vessel_name, sort_by, sort_dir,
        requisition_no, po_no, readiness_date_from, readiness_date_to,
        exclude_entry_types=["PD"],
    )
    live_filters = _LiveFilters(
        pr_status, po_status, vendor, supply_port, order_status,
        delivery_status, remarks, invoice_type, invoice_status, payment_status,
    )
    rows, _total = _filter_and_paginate_enriched(db, query, live_filters, None, None)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "DD Tracker"

    header_fill = PatternFill("solid", fgColor="0F4C81")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    headers = [label for label, _ in _EXPORT_COLUMNS]
    sheet.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = sheet.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for row in rows:
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
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=DD_Tracker_By_PO.xlsx"},
    )


@router.get("/vessel-options", response_model=list[str])
def list_vessel_options(db: Session = Depends(get_db)) -> list[str]:
    """Distinct vessel names currently tracked, for the toolbar's vessel filter dropdown — these
    are free-text SmartPAL vessel names (see dd_tracker_entry.py), not a join to the `vessels`
    table, since DD Tracker rows aren't FK'd to it."""
    rows = (
        db.query(DdTrackerEntry.vessel_name)
        .filter(
            DdTrackerEntry.vessel_name.isnot(None),
            DdTrackerEntry.deleted_at.is_(None),
            or_(DdTrackerEntry.entry_type.is_(None), DdTrackerEntry.entry_type != "PD"),
        )
        .distinct()
        .order_by(DdTrackerEntry.vessel_name)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/filter-options", response_model=DdTrackerFilterOptions)
def get_dd_tracker_filter_options(db: Session = Depends(get_db)) -> DdTrackerFilterOptions:
    """Distinct values for every new Excel-style column filter (2026-11-11, direct purchaser
    feedback) — computed from the full, unfiltered enriched row set (same as vessel-options
    above), not from whatever's currently filtered, so narrowing one filter never shrinks the
    choices available in another. Excludes PD Tracker rows (added 2026-11-12), same partition as
    _filtered_query's own exclude_entry_types=["PD"]."""
    rows = (
        db.query(DdTrackerEntry)
        .filter(
            DdTrackerEntry.deleted_at.is_(None),
            or_(DdTrackerEntry.entry_type.is_(None), DdTrackerEntry.entry_type != "PD"),
        )
        .all()
    )
    enriched = _attach_live_data(db, rows)

    def _distinct(values: list[str | None]) -> list[str]:
        return sorted({v for v in values if v})

    return DdTrackerFilterOptions(
        pr_status=_distinct([e.pr_status_live for e in enriched]),
        po_status=_distinct([e.po_approved_status for e in enriched]),
        vendor=_distinct([e.po_vendor for e in enriched]),
        order_status=_distinct([e.order_status for e in enriched]),
        delivery_status=_distinct([e.supply_confirmation for e in enriched]),
        invoice_type=_distinct([e.invoice_type for e in enriched]),
        invoice_status=_distinct([e.invoice_status for e in enriched]),
        payment_status=_distinct([e.payment_status for e in enriched]),
    )


@router.get("/pr-lookup", response_model=list[PrLookupResult])
def lookup_pr_entries(
    q: str = Query(min_length=2),
    db: Session = Depends(get_db),
) -> list[PrLookupResult]:
    """Autocomplete for the "link a Purchase Requisition" picker on the add/edit row form."""
    escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    rows = (
        db.query(PrEntry)
        .filter(or_(PrEntry.requisition_no.ilike(pattern, escape="\\"), PrEntry.title.ilike(pattern, escape="\\")))
        .order_by(PrEntry.last_scraped_at.desc())
        .limit(20)
        .all()
    )
    return [
        PrLookupResult(
            requisition_no=r.requisition_no, title=r.title, vessel_name=r.vessel_name,
            req_category=r.req_category, status=_effective_pr_status(r),
        )
        for r in rows
    ]


@router.get("/po-lookup", response_model=list[PoLookupResult])
def lookup_po_entries(
    q: str = Query(min_length=2),
    db: Session = Depends(get_db),
) -> list[PoLookupResult]:
    """Autocomplete for the "link a Purchase Order" picker on the add/edit row form."""
    escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    rows = (
        db.query(PoEntry)
        .filter(or_(PoEntry.po_no.ilike(pattern, escape="\\"), PoEntry.title.ilike(pattern, escape="\\")))
        .order_by(PoEntry.last_scraped_at.desc())
        .limit(20)
        .all()
    )
    return [
        PoLookupResult(
            po_no=r.po_no, title=r.title, vessel_name=r.vessel_name, vendor=r.vendor,
            req_category=r.req_category, approved_status=r.approved_status,
        )
        for r in rows
    ]


@router.post("", response_model=DdTrackerEntryOut, status_code=status.HTTP_201_CREATED)
def create_dd_tracker_entry(
    payload: DdTrackerEntryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> DdTrackerEntryOut:
    entry = DdTrackerEntry(**payload.model_dump(), created_by=current_user.id, updated_by=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    if entry.po_no:
        has_items = db.query(PoItemEntry.id).filter(PoItemEntry.po_no == entry.po_no).first() is not None
        if not has_items:
            background_tasks.add_task(scrape_dd_po_items, target_po_nos=[entry.po_no])
    pr, po, invoice = _fetch_live(db, entry)
    return _to_out(entry, pr, po, invoice)


@router.patch("/{entry_id}", response_model=DdTrackerEntryOut)
def update_dd_tracker_entry(
    entry_id: uuid.UUID,
    payload: DdTrackerEntryUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> DdTrackerEntryOut:
    entry = db.get(DdTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DD Tracker entry not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    entry.updated_by = current_user.id
    entry.updated_at = datetime.now()
    db.commit()
    db.refresh(entry)
    if entry.po_no:
        has_items = db.query(PoItemEntry.id).filter(PoItemEntry.po_no == entry.po_no).first() is not None
        if not has_items:
            background_tasks.add_task(scrape_dd_po_items, target_po_nos=[entry.po_no])
    pr, po, invoice = _fetch_live(db, entry)
    return _to_out(entry, pr, po, invoice)


@router.post("/bulk-delete", response_model=DdTrackerBulkDeleteResult)
def bulk_delete_dd_tracker_entries(
    payload: DdTrackerBulkDeleteRequest,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> DdTrackerBulkDeleteResult:
    """Soft-deletes every row in payload.ids (checkbox multi-select + "Delete Selected" on the
    table) in one round trip — see DdTrackerEntry.deleted_at. Unknown/already-deleted ids are
    silently ignored rather than erroring the whole batch, since the selection the frontend sends
    was read from the table a moment earlier and could only be stale, never malformed."""
    now = datetime.now()
    updated = (
        db.query(DdTrackerEntry)
        .filter(DdTrackerEntry.id.in_(payload.ids), DdTrackerEntry.deleted_at.is_(None))
        .update({DdTrackerEntry.deleted_at: now}, synchronize_session=False)
    )
    db.commit()
    return DdTrackerBulkDeleteResult(deleted_count=updated)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dd_tracker_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    entry = db.get(DdTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DD Tracker entry not found")
    entry.deleted_at = datetime.now()
    db.commit()


def _tracker_po_no_scope(db: Session, include_entry_types: list[str] | None, exclude_entry_types: list[str] | None):
    """Builds the subquery of po_no values that belong to a given tracker category, for scoping
    the "By Account Code" view (and its vessel/account-code option lists) to only that category's
    POs. Added 2026-11-12 alongside PD Tracker: po_item_entries has no category column of its own
    (it's keyed purely by po_no — see its docstring), and "Sync New POs" syncs items for every
    untracked po_no across ALL dd_tracker_entries regardless of entry_type, so DD's and PD's items
    would silently end up in the same table together. include_entry_types scopes to exactly those
    types (PD Tracker passes ["PD"]); exclude_entry_types scopes to everything EXCEPT those types,
    including NULL/untyped rows (DD Tracker passes ["PD"] here, preserving its existing behavior
    of also showing the 34 pre-existing manually-tagged OPEX rows — confirmed live 2026-11-12 these
    exist — rather than narrowing DD down to entry_type=='DD' only, which would hide them)."""
    base = db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.deleted_at.is_(None), DdTrackerEntry.po_no.isnot(None))
    if include_entry_types:
        return base.filter(DdTrackerEntry.entry_type.in_(include_entry_types))
    if exclude_entry_types:
        from sqlalchemy import or_ as _or

        return base.filter(_or(DdTrackerEntry.entry_type.is_(None), DdTrackerEntry.entry_type.notin_(exclude_entry_types)))
    return base


def _compute_account_code_analysis(
    db: Session,
    vessel_name: list[str] | None,
    account_code: list[str] | None,
    search: str | None,
    include_entry_types: list[str] | None = None,
    exclude_entry_types: list[str] | None = None,
) -> AccountCodeAnalysisResponse:
    """Grouped analysis of PO line items and additional charges:
    Grouped by PO, with each PO showing its account codes and line items.
    If a PO has 2 or more account codes, each account code has its own spend & items.
    """
    po_no_scope = _tracker_po_no_scope(db, include_entry_types, exclude_entry_types)

    vessel_options = [
        r[0]
        for r in db.query(PoItemEntry.vessel_name)
        .filter(PoItemEntry.vessel_name.isnot(None), PoItemEntry.po_no.in_(po_no_scope))
        .distinct()
        .order_by(PoItemEntry.vessel_name)
        .all()
    ]
    account_code_options = [
        r[0]
        for r in db.query(PoItemEntry.account_code)
        .filter(PoItemEntry.account_code.isnot(None), PoItemEntry.po_no.in_(po_no_scope))
        .distinct()
        .order_by(PoItemEntry.account_code)
        .all()
    ]

    query = db.query(PoItemEntry).filter(PoItemEntry.po_no.in_(po_no_scope))

    # Safely handle FastAPI Query default objects if called directly
    v_clean = vessel_name if isinstance(vessel_name, (list, str)) and vessel_name else None
    a_clean = account_code if isinstance(account_code, (list, str)) and account_code else None
    s_clean = search if isinstance(search, str) and search.strip() else None

    if v_clean:
        v_list = v_clean if isinstance(v_clean, list) else [v_clean]
        query = query.filter(PoItemEntry.vessel_name.in_(v_list))
    if a_clean:
        a_list = a_clean if isinstance(a_clean, list) else [a_clean]
        query = query.filter(PoItemEntry.account_code.in_(a_list))
    if s_clean:
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            or_(
                PoItemEntry.account_code.ilike(pattern, escape="\\"),
                PoItemEntry.item_description.ilike(pattern, escape="\\"),
                PoItemEntry.part_number.ilike(pattern, escape="\\"),
                PoItemEntry.po_no.ilike(pattern, escape="\\"),
                PoItemEntry.vessel_name.ilike(pattern, escape="\\"),
            )
        )

    rows = query.order_by(
        PoItemEntry.po_no.asc(),
        PoItemEntry.account_code.asc(),
        PoItemEntry.item_type.asc(),
    ).all()

    po_nos = {r.po_no for r in rows}
    pos_map = {p.po_no: p for p in db.query(PoEntry).filter(PoEntry.po_no.in_(po_nos)).all()} if po_nos else {}

    accts_dict: dict[str, dict] = {}
    pos_dict: dict[str, dict] = {}
    distinct_vessels = set()
    distinct_accounts = set()
    grand_total_inr = Decimal(0)
    grand_total_usd = Decimal(0)

    for r in rows:
        po_key = r.po_no
        acct_key = r.account_code or "Uncategorized"
        distinct_vessels.add(r.vessel_name)
        distinct_accounts.add(acct_key)

        spend_inr = r.total_amount_inr or Decimal(0)
        spend_usd = r.total_amount_usd or Decimal(0)
        grand_total_inr += spend_inr
        grand_total_usd += spend_usd

        po_info = pos_map.get(po_key)
        item_out = PoItemDetailOut(
            id=r.id,
            po_no=r.po_no,
            vessel_name=r.vessel_name,
            item_type=r.item_type,
            account_code=r.account_code,
            account_code_desc=r.account_code_desc,
            part_number=r.part_number,
            item_description=r.item_description,
            rob=r.rob,
            unit_price=r.unit_price,
            quantity=r.quantity,
            discount_pct=r.discount_pct,
            total_amount_inr=r.total_amount_inr,
            total_amount_usd=r.total_amount_usd,
            vat_key=r.vat_key,
            vat_pct=r.vat_pct,
            sub_account_code=r.sub_account_code,
            analysis_code=r.analysis_code,
            client_code=r.client_code,
            drawing_no=r.drawing_no,
            scraped_at=r.last_scraped_at,
        )

        # 1. Group by Account Code (Primary flow: Account Code -> POs)
        if acct_key not in accts_dict:
            accts_dict[acct_key] = {
                "account_code": acct_key,
                "account_code_desc": r.account_code_desc,
                "total_spend_inr": Decimal(0),
                "total_spend_usd": Decimal(0),
                "total_pos": 0,
                "total_items": 0,
                "pos_map": {},
            }
        acct_entry = accts_dict[acct_key]
        acct_entry["total_spend_inr"] += spend_inr
        acct_entry["total_spend_usd"] += spend_usd
        acct_entry["total_items"] += 1

        if po_key not in acct_entry["pos_map"]:
            acct_entry["pos_map"][po_key] = {
                "po_no": po_key,
                "vessel_name": r.vessel_name or (po_info.vessel_name if po_info else None),
                "po_title": po_info.title if po_info else None,
                "vendor": po_info.vendor if po_info else None,
                "currency": po_info.base_currency if po_info else None,
                "po_base_amount": po_info.base_amount if po_info else None,
                "total_spend_inr": Decimal(0),
                "total_spend_usd": Decimal(0),
                "item_count": 0,
                "items": [],
            }
        po_in_acct = acct_entry["pos_map"][po_key]
        po_in_acct["total_spend_inr"] += spend_inr
        po_in_acct["total_spend_usd"] += spend_usd
        po_in_acct["item_count"] += 1
        po_in_acct["items"].append(item_out)

        # 2. Group by PO (for backward compatibility if needed)
        if po_key not in pos_dict:
            pos_dict[po_key] = {
                "po_no": po_key,
                "vessel_name": r.vessel_name or (po_info.vessel_name if po_info else None),
                "po_title": po_info.title if po_info else None,
                "vendor": po_info.vendor if po_info else None,
                "currency": po_info.base_currency if po_info else None,
                "po_base_amount": po_info.base_amount if po_info else None,
                "total_spend_inr": Decimal(0),
                "total_spend_usd": Decimal(0),
                "total_items": 0,
                "account_codes_map": {},
            }
        po_entry_data = pos_dict[po_key]
        po_entry_data["total_spend_inr"] += spend_inr
        po_entry_data["total_spend_usd"] += spend_usd
        po_entry_data["total_items"] += 1

        if acct_key not in po_entry_data["account_codes_map"]:
            po_entry_data["account_codes_map"][acct_key] = {
                "account_code": acct_key,
                "account_code_desc": r.account_code_desc,
                "total_spend_inr": Decimal(0),
                "total_spend_usd": Decimal(0),
                "item_count": 0,
                "items": [],
            }
        acct_data = po_entry_data["account_codes_map"][acct_key]
        acct_data["total_spend_inr"] += spend_inr
        acct_data["total_spend_usd"] += spend_usd
        acct_data["item_count"] += 1
        acct_data["items"].append(item_out)

    # Build account_groups (Account Code -> POs)
    account_groups = []
    for acct_data in accts_dict.values():
        po_list = [PoSpendForAccountCode(**p) for p in acct_data["pos_map"].values()]
        po_list.sort(key=lambda p: p.total_spend_usd, reverse=True)
        account_groups.append(
            AccountCodeGroup(
                account_code=acct_data["account_code"],
                account_code_desc=acct_data["account_code_desc"],
                total_spend_inr=acct_data["total_spend_inr"],
                total_spend_usd=acct_data["total_spend_usd"],
                total_pos=len(po_list),
                total_items=acct_data["total_items"],
                pos=po_list,
            )
        )
    account_groups.sort(key=lambda a: a.total_spend_usd, reverse=True)

    # Build po_groups (PO -> Account Codes)
    po_groups = []
    for po_data in pos_dict.values():
        acct_list = [AccountCodeSpendForPo(**a) for a in po_data["account_codes_map"].values()]
        acct_list.sort(key=lambda a: a.total_spend_usd, reverse=True)
        po_groups.append(
            PoAccountGroup(
                po_no=po_data["po_no"],
                vessel_name=po_data["vessel_name"],
                po_title=po_data["po_title"],
                vendor=po_data["vendor"],
                currency=po_data["currency"],
                po_base_amount=po_data["po_base_amount"],
                total_spend_inr=po_data["total_spend_inr"],
                total_spend_usd=po_data["total_spend_usd"],
                total_account_codes=len(acct_list),
                total_items=po_data["total_items"],
                account_codes=acct_list,
            )
        )
    po_groups.sort(key=lambda p: p.total_spend_usd, reverse=True)

    return AccountCodeAnalysisResponse(
        account_codes=account_groups,
        pos=po_groups,
        total_pos=len(po_groups),
        total_vessels=len(distinct_vessels),
        total_account_codes=len(account_groups),
        total_items=len(rows),
        grand_total_spend_inr=grand_total_inr,
        grand_total_spend_usd=grand_total_usd,
        vessel_options=vessel_options,
        account_code_options=account_code_options,
    )


# Column-header sort for the "By Account Code" view, added 2026-11-11 alongside the matching
# Excel-style filter. The table's rows are (account_code, po) pairs grouped visually under their
# account code (see DdAccountCodeTable.tsx), so a naive flat sort across everything would scramble
# that grouping. Instead: "accountCode"/"totalItems"/"totalSpendInr"/"totalSpendUsd" reorder the
# account-code GROUPS themselves (overriding the default total_spend_usd-desc order); "vesselName"/
# "poNo" instead reorder the POs WITHIN each group, leaving the groups' own order untouched —
# either way the account-code grouping itself never gets interleaved.
_ACCOUNT_GROUP_SORT_KEYS = {
    "accountCode": lambda g: (g.account_code or "").lower(),
    "totalItems": lambda g: g.total_items,
    "totalSpendInr": lambda g: g.total_spend_inr,
    "totalSpendUsd": lambda g: g.total_spend_usd,
}
_PO_WITHIN_GROUP_SORT_KEYS = {
    "vesselName": lambda p: (p.vessel_name or "").lower(),
    "poNo": lambda p: p.po_no or "",
}


def _apply_account_code_sort(response: AccountCodeAnalysisResponse, sort_by: str | None, sort_dir: str) -> None:
    reverse = sort_dir == "desc"
    if sort_by in _ACCOUNT_GROUP_SORT_KEYS:
        response.account_codes.sort(key=_ACCOUNT_GROUP_SORT_KEYS[sort_by], reverse=reverse)
    elif sort_by in _PO_WITHIN_GROUP_SORT_KEYS:
        key = _PO_WITHIN_GROUP_SORT_KEYS[sort_by]
        for group in response.account_codes:
            group.pos.sort(key=key, reverse=reverse)


@router.get("/account-code-analysis", response_model=AccountCodeAnalysisResponse)
def get_account_code_analysis(
    db: Session = Depends(get_db),
    vessel_name: list[str] | None = Query(default=None),
    account_code: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> AccountCodeAnalysisResponse:
    response = _compute_account_code_analysis(db, vessel_name, account_code, search, exclude_entry_types=["PD"])
    _apply_account_code_sort(response, sort_by, sort_dir)
    return response


# Flattened (account_code, po) row per line, matching exactly what DdAccountCodeTable.tsx renders
# — confirmed with the user 2026-11-11 this summary level (not every individual PO line item) is
# what the export should contain.
_ACCOUNT_CODE_EXPORT_COLUMNS = [
    "Account Code", "Account Code Description", "Vessel", "PO Number", "Vendor",
    "Currency", "Item Count", "Spend (INR)", "Spend (USD)",
]


@router.get("/account-code-analysis/export")
def export_account_code_analysis(
    db: Session = Depends(get_db),
    vessel_name: list[str] | None = Query(default=None),
    account_code: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    response = _compute_account_code_analysis(db, vessel_name, account_code, search, exclude_entry_types=["PD"])
    _apply_account_code_sort(response, sort_by, sort_dir)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "DD Tracker - By Account Code"

    header_fill = PatternFill("solid", fgColor="0F4C81")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    sheet.append(_ACCOUNT_CODE_EXPORT_COLUMNS)
    for col_idx in range(1, len(_ACCOUNT_CODE_EXPORT_COLUMNS) + 1):
        cell = sheet.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for group in response.account_codes:
        for po in group.pos:
            sheet.append([
                group.account_code, group.account_code_desc, po.vessel_name, po.po_no, po.vendor,
                po.currency, po.item_count, po.total_spend_inr, po.total_spend_usd,
            ])

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=DD_Tracker_By_Account_Code.xlsx"},
    )


@router.post("/sync-items", response_model=SyncPoItemsResponse)
def sync_po_items(
    payload: SyncPoItemsRequest | None = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> SyncPoItemsResponse:
    """Trigger PO line items & additional charges scraping from SmartPAL for DD POs."""
    target_pos = payload.po_nos if payload else None
    force = payload.force if payload else False
    result = scrape_dd_po_items(target_po_nos=target_pos, force=force)
    return SyncPoItemsResponse(
        scraped_pos=result.get("scraped_pos", 0),
        items=result.get("items", 0),
        add_amounts=result.get("add_amounts", 0),
        errors=result.get("errors", 0),
        message=result.get("message"),
    )

