import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Query as OrmQuery
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.models.user import User
from app.schemas.common import PaginatedResult
from app.schemas.dd_tracker import (
    DdTrackerEntryCreate,
    DdTrackerEntryOut,
    DdTrackerEntryUpdate,
    PoLookupResult,
    PrLookupResult,
)

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


def _to_out(entry: DdTrackerEntry, pr: PrEntry | None, po: PoEntry | None) -> DdTrackerEntryOut:
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
        lead_days=entry.lead_days,
        readiness_date=entry.readiness_date,
        ex_stock=entry.ex_stock,
        supply_confirmation=entry.supply_confirmation,
        remarks_1=entry.remarks_1,
        remarks_2=entry.remarks_2,
        invoice_number=entry.invoice_number,
        invoice_type=entry.invoice_type,
        invoice_amount=entry.invoice_amount,
        invoice_currency=entry.invoice_currency,
        payment_status=entry.payment_status,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        pr_title=pr.title if pr else None,
        pr_status_live=pr.status if pr else None,
        pr_department=pr.department if pr else None,
        pr_req_category=pr.req_category if pr else None,
        po_title=po.title if po else None,
        po_vendor=po.vendor if po else None,
        po_req_category=po.req_category if po else None,
        po_approved_status=po.approved_status if po else None,
        po_invoice_status=po.invoice_status if po else None,
        po_base_amount=po.base_amount if po else None,
        po_base_currency=po.base_currency if po else None,
        po_confirmed_date=po.confirmed_date if po else None,
        po_schd_del_port=po.schd_del_port if po else None,
        po_agent_name=po.agent_name if po else None,
        po_warehouse_name=po.warehouse_name if po else None,
        po_grn_nos=po.grn_nos if po else None,
        po_do_nos=po.do_nos if po else None,
    )


def _filtered_query(
    db: Session,
    search: str | None,
    entry_type: list[str] | None,
    vessel_name: list[str] | None,
    sort_by: str | None,
    sort_dir: str,
) -> OrmQuery:
    query = db.query(DdTrackerEntry)

    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
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
                        DdTrackerEntry.remarks_1,
                        DdTrackerEntry.remarks_2,
                    )
                ]
            )
        )
    if entry_type:
        query = query.filter(DdTrackerEntry.entry_type.in_(entry_type))
    if vessel_name:
        query = query.filter(DdTrackerEntry.vessel_name.in_(vessel_name))

    sort_column = _SORTABLE_COLUMNS.get(sort_by) if sort_by else None
    if sort_column is not None:
        ordered = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        return query.order_by(ordered.nulls_last(), DdTrackerEntry.seq_no.asc())
    return query.order_by(DdTrackerEntry.seq_no.asc())


def _attach_live_data(db: Session, entries: list[DdTrackerEntry]) -> list[DdTrackerEntryOut]:
    req_nos = {e.requisition_no for e in entries if e.requisition_no}
    po_nos = {e.po_no for e in entries if e.po_no}
    prs = {p.requisition_no: p for p in db.query(PrEntry).filter(PrEntry.requisition_no.in_(req_nos)).all()} if req_nos else {}
    pos = {p.po_no: p for p in db.query(PoEntry).filter(PoEntry.po_no.in_(po_nos)).all()} if po_nos else {}
    return [_to_out(e, prs.get(e.requisition_no), pos.get(e.po_no)) for e in entries]


@router.get("", response_model=PaginatedResult[DdTrackerEntryOut])
def list_dd_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    entry_type: list[str] | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="asc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[DdTrackerEntryOut]:
    query = _filtered_query(db, search, entry_type, vessel_name, sort_by, sort_dir)
    total = query.order_by(None).count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResult[DdTrackerEntryOut](
        items=_attach_live_data(db, rows), total=total, page=page, page_size=page_size
    )


@router.get("/vessel-options", response_model=list[str])
def list_vessel_options(db: Session = Depends(get_db)) -> list[str]:
    """Distinct vessel names currently tracked, for the toolbar's vessel filter dropdown — these
    are free-text SmartPAL vessel names (see dd_tracker_entry.py), not a join to the `vessels`
    table, since DD Tracker rows aren't FK'd to it."""
    rows = (
        db.query(DdTrackerEntry.vessel_name)
        .filter(DdTrackerEntry.vessel_name.isnot(None))
        .distinct()
        .order_by(DdTrackerEntry.vessel_name)
        .all()
    )
    return [r[0] for r in rows]


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
            req_category=r.req_category, status=r.status,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> DdTrackerEntryOut:
    entry = DdTrackerEntry(**payload.model_dump(), created_by=current_user.id, updated_by=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    pr = db.query(PrEntry).filter(PrEntry.requisition_no == entry.requisition_no).first() if entry.requisition_no else None
    po = db.query(PoEntry).filter(PoEntry.po_no == entry.po_no).first() if entry.po_no else None
    return _to_out(entry, pr, po)


@router.patch("/{entry_id}", response_model=DdTrackerEntryOut)
def update_dd_tracker_entry(
    entry_id: uuid.UUID,
    payload: DdTrackerEntryUpdate,
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
    pr = db.query(PrEntry).filter(PrEntry.requisition_no == entry.requisition_no).first() if entry.requisition_no else None
    po = db.query(PoEntry).filter(PoEntry.po_no == entry.po_no).first() if entry.po_no else None
    return _to_out(entry, pr, po)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dd_tracker_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    entry = db.get(DdTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DD Tracker entry not found")
    db.delete(entry)
    db.commit()
