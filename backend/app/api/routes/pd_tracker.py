# ===========================================================================
# backend/app/api/routes/pd_tracker.py
#
# PD (Pre-Delivery) Tracker — a fully separate module from DD Tracker (own nav link, own
# can_access_pd flag, own /pd-tracker prefix), added 2026-11-12 per direct user request: "replicate
# DD Tracker for PD". Reuses the SAME dd_tracker_entries/po_item_entries tables as DD Tracker
# (entry_type is a plain free-text column — "PD" was already a valid value, just never
# auto-populated before this) and the SAME shared helper functions dd_tracker.py already defines
# (_to_out, _filtered_query, _LiveFilters, _compute_account_code_analysis, etc.) — deliberately NOT
# a copy-pasted duplicate of ~600 lines, since the two trackers must evolve in lockstep (a new
# column filter added to one is meaningless unless it's also on the other).
#
# Unlike DD Tracker's own endpoints (which leave entry_type as an OPTIONAL filter, preserving 34
# pre-existing manually-tagged OPEX rows that would otherwise vanish from view — confirmed live
# 2026-11-12), every endpoint here FORCES entry_type == "PD": there is zero pre-existing PD data,
# so this is simply this tracker's whole and only scope, and forcing it means a user can never
# accidentally create/see a non-PD row through this page.
# ===========================================================================
import uuid
from datetime import date, datetime
from io import BytesIO

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.api.routes.dd_tracker import (
    _EXPORT_COLUMNS,
    _LiveFilters,
    _apply_account_code_sort,
    _attach_live_data,
    _compute_account_code_analysis,
    _effective_pr_status,
    _fetch_live,
    _filter_and_paginate_enriched,
    _filtered_query,
    _to_out,
)
from app.core.enums import UserRole
from app.db.session import get_db
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.po_item_entry import PoItemEntry
from app.models.pr_entry import PrEntry
from app.models.user import User
from app.schemas.common import PaginatedResult
from app.schemas.dd_tracker import (
    AccountCodeAnalysisResponse,
    DdTrackerBulkDeleteRequest,
    DdTrackerBulkDeleteResult,
    DdTrackerEntryCreate,
    DdTrackerEntryOut,
    DdTrackerEntryUpdate,
    DdTrackerFilterOptions,
    PoLookupResult,
    PrLookupResult,
    SyncPoItemsRequest,
    SyncPoItemsResponse,
)
from app.services.po_scraper.scraper import scrape_dd_po_items

_CATEGORY = "PD"

router = APIRouter(
    prefix="/pd-tracker",
    tags=["pd-tracker"],
    dependencies=[Depends(require_module_access("pd"))],
)

_writers = require_roles(UserRole.ADMIN, UserRole.EDITOR)


@router.get("", response_model=PaginatedResult[DdTrackerEntryOut])
def list_pd_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
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
        db, search, [_CATEGORY], vessel_name, sort_by, sort_dir,
        requisition_no, po_no, readiness_date_from, readiness_date_to,
    )
    live_filters = _LiveFilters(
        pr_status, po_status, vendor, supply_port, order_status,
        delivery_status, remarks, invoice_type, invoice_status, payment_status,
    )
    items, total = _filter_and_paginate_enriched(db, query, live_filters, page, page_size)
    return PaginatedResult[DdTrackerEntryOut](items=items, total=total, page=page, page_size=page_size)


@router.get("/export")
def export_pd_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
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
    exactly what's on screen right now". Mirrors dd_tracker.py's export_dd_tracker_entries."""
    query = _filtered_query(
        db, search, [_CATEGORY], vessel_name, sort_by, sort_dir,
        requisition_no, po_no, readiness_date_from, readiness_date_to,
    )
    live_filters = _LiveFilters(
        pr_status, po_status, vendor, supply_port, order_status,
        delivery_status, remarks, invoice_type, invoice_status, payment_status,
    )
    rows, _total = _filter_and_paginate_enriched(db, query, live_filters, None, None)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "PD Tracker"

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
        headers={"Content-Disposition": "attachment; filename=PD_Tracker_By_PO.xlsx"},
    )


@router.get("/vessel-options", response_model=list[str])
def list_pd_vessel_options(db: Session = Depends(get_db)) -> list[str]:
    """Distinct vessel names tracked under PD specifically (unlike DD's own vessel-options, this
    one DOES scope by entry_type — there's no pre-existing non-PD data here to preserve)."""
    rows = (
        db.query(DdTrackerEntry.vessel_name)
        .filter(
            DdTrackerEntry.vessel_name.isnot(None),
            DdTrackerEntry.deleted_at.is_(None),
            DdTrackerEntry.entry_type == _CATEGORY,
        )
        .distinct()
        .order_by(DdTrackerEntry.vessel_name)
        .all()
    )
    return [r[0] for r in rows]


@router.get("/filter-options", response_model=DdTrackerFilterOptions)
def get_pd_tracker_filter_options(db: Session = Depends(get_db)) -> DdTrackerFilterOptions:
    """Mirrors dd_tracker.py's get_dd_tracker_filter_options, scoped to entry_type == 'PD'."""
    rows = (
        db.query(DdTrackerEntry)
        .filter(DdTrackerEntry.deleted_at.is_(None), DdTrackerEntry.entry_type == _CATEGORY)
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
def lookup_pr_entries(q: str = Query(min_length=2), db: Session = Depends(get_db)) -> list[PrLookupResult]:
    """Autocomplete for the "link a Purchase Requisition" picker — same as dd_tracker.py's own
    (searches ALL PRs, not just PD-category ones: the picker is for "items that need tracking here
    but SmartPAL neither categorizes nor titles as PD", same reasoning as DD's version). Duplicated
    rather than imported since dd_tracker.py's router-level dependency gates its own copy on
    can_access_dd, which a PD-only user wouldn't have."""
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
def lookup_po_entries(q: str = Query(min_length=2), db: Session = Depends(get_db)) -> list[PoLookupResult]:
    """Autocomplete for the "link a Purchase Order" picker — see lookup_pr_entries above."""
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
def create_pd_tracker_entry(
    payload: DdTrackerEntryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> DdTrackerEntryOut:
    # entry_type is always forced to "PD" here — overriding whatever the submitted form's Type
    # dropdown held, same reasoning as the module docstring above: this page's whole scope IS "PD",
    # a client-submitted different value would just be a stale/leftover default from the shared
    # add-entry form component, never an intentional choice on this page.
    data = payload.model_dump()
    data["entry_type"] = _CATEGORY
    entry = DdTrackerEntry(**data, created_by=current_user.id, updated_by=current_user.id)
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
def update_pd_tracker_entry(
    entry_id: uuid.UUID,
    payload: DdTrackerEntryUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> DdTrackerEntryOut:
    entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.id == entry_id, DdTrackerEntry.entry_type == _CATEGORY).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PD Tracker entry not found")

    updates = payload.model_dump(exclude_unset=True)
    updates["entry_type"] = _CATEGORY
    for field, value in updates.items():
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
def bulk_delete_pd_tracker_entries(
    payload: DdTrackerBulkDeleteRequest,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> DdTrackerBulkDeleteResult:
    now = datetime.now()
    updated = (
        db.query(DdTrackerEntry)
        .filter(
            DdTrackerEntry.id.in_(payload.ids),
            DdTrackerEntry.deleted_at.is_(None),
            DdTrackerEntry.entry_type == _CATEGORY,
        )
        .update({DdTrackerEntry.deleted_at: now}, synchronize_session=False)
    )
    db.commit()
    return DdTrackerBulkDeleteResult(deleted_count=updated)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pd_tracker_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.id == entry_id, DdTrackerEntry.entry_type == _CATEGORY).first()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PD Tracker entry not found")
    entry.deleted_at = datetime.now()
    db.commit()


@router.get("/account-code-analysis", response_model=AccountCodeAnalysisResponse)
def get_pd_account_code_analysis(
    db: Session = Depends(get_db),
    vessel_name: list[str] | None = Query(default=None),
    account_code: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> AccountCodeAnalysisResponse:
    response = _compute_account_code_analysis(db, vessel_name, account_code, search, include_entry_types=[_CATEGORY])
    _apply_account_code_sort(response, sort_by, sort_dir)
    return response


@router.get("/account-code-analysis/export")
def export_pd_account_code_analysis(
    db: Session = Depends(get_db),
    vessel_name: list[str] | None = Query(default=None),
    account_code: list[str] | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    response = _compute_account_code_analysis(db, vessel_name, account_code, search, include_entry_types=[_CATEGORY])
    _apply_account_code_sort(response, sort_by, sort_dir)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "PD Tracker - By Account Code"

    header_fill = PatternFill("solid", fgColor="0F4C81")
    header_font = Font(bold=True, color="FFFFFF", name="Calibri", size=11)
    columns = [
        "Account Code", "Account Code Description", "Vessel", "PO Number", "Vendor",
        "Currency", "Item Count", "Spend (INR)", "Spend (USD)",
    ]
    sheet.append(columns)
    for col_idx in range(1, len(columns) + 1):
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
        headers={"Content-Disposition": "attachment; filename=PD_Tracker_By_Account_Code.xlsx"},
    )


@router.post("/sync-items", response_model=SyncPoItemsResponse)
def sync_po_items(
    payload: SyncPoItemsRequest | None = None,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> SyncPoItemsResponse:
    """Same underlying scrape_dd_po_items as dd_tracker.py — it already walks every untracked
    po_no across ALL dd_tracker_entries regardless of entry_type (see its own docstring), so this
    endpoint exists only to give PD Tracker its own gated "Sync New POs" button, not because the
    scrape itself needs a PD-specific code path."""
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
