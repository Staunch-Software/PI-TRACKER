from collections import Counter
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_module_access, require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.models.user import User
from app.schemas.common import PaginatedResult
from app.schemas.soa_entry import SoaKpisOut, SoaLineItemOut, SoaRematchResult
from app.services.soa_scraper.matching import rematch_all_current_line_items

router = APIRouter(prefix="/soa-entries", tags=["soa-entries"])

# Only CURRENT soa_documents ever feed this view — a superseded SOA's line items exist purely
# for audit history (see SoaDocument docstring) and are never shown/matched going forward.
_BASE_QUERY = """
    FROM soa_line_items sli
    JOIN soa_documents sd ON sd.id = sli.soa_document_id AND sd.is_current = TRUE
    LEFT JOIN vessels v ON v.id = sli.vessel_id
"""

_SORTABLE_COLUMNS = {
    "invoiceNumber": "sli.invoice_number",
    "invoiceDate": "sli.invoice_date",
    "amount": "sli.amount",
    "vendorName": "sd.vendor_name_raw",
    "vesselName": "COALESCE(v.name, sli.vessel_name_raw)",
    "matchSource": "sli.match_source",
    "soaReceivedAt": "sd.received_at",
}


def _build_where_clause(search: str | None, match_source: str | None, vessel_id: str | None) -> tuple[str, dict]:
    where_clauses = []
    params: dict = {}

    if search:
        where_clauses.append(
            "(sli.invoice_number ILIKE :search OR sd.vendor_name_raw ILIKE :search "
            "OR sli.vessel_name_raw ILIKE :search OR v.name ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    if match_source and match_source != "ALL":
        where_clauses.append("sli.match_source = :match_source")
        params["match_source"] = match_source
    if vessel_id:
        where_clauses.append("sli.vessel_id = :vessel_id")
        params["vessel_id"] = vessel_id

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    return where_sql, params


@router.get("", response_model=PaginatedResult[SoaLineItemOut])
def list_soa_entries(
    db: Session = Depends(get_db),
    _: User = Depends(require_module_access("soa")),
    search: str | None = Query(default=None),
    match_source: str | None = Query(default=None, description="SMARTPAL | PIR | INVOICE_MAIL | NONE | ALL"),
    vessel_id: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    # Upper bound matches PIRPage's FETCH_ALL_PAGE_SIZE convention — no per-row UI pagination on
    # this page yet, so the frontend fetches everything matching the current filter in one call.
    page_size: int = Query(default=50, ge=1, le=5000),
) -> dict:
    where_sql, params = _build_where_clause(search, match_source, vessel_id)

    total = db.execute(text(f"SELECT count(*) {_BASE_QUERY} {where_sql}"), params).scalar_one()

    if sort_by and sort_by in _SORTABLE_COLUMNS:
        order_sql = f"ORDER BY {_SORTABLE_COLUMNS[sort_by]} {sort_dir.upper()} NULLS LAST, sd.received_at DESC"
    else:
        order_sql = "ORDER BY sd.received_at DESC, sli.invoice_number"

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(
        text(
            f"""
            SELECT sli.*, v.name AS vessel_name,
                   sd.vendor_name_raw, sd.sender_email, sd.sender_domain, sd.canonical_domain, sd.has_attachment,
                   sd.subject AS soa_subject, sd.received_at AS soa_received_at
            {_BASE_QUERY} {where_sql} {order_sql} LIMIT :limit OFFSET :offset
            """
        ),
        params,
    ).mappings().all()

    return {"items": [dict(row) for row in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/kpis", response_model=SoaKpisOut)
def get_soa_kpis(db: Session = Depends(get_db), _: User = Depends(require_module_access("soa"))) -> dict:
    rows = db.execute(
        text(
            f"""
            SELECT sli.match_source, sli.remaining_amount, sli.amount, sli.currency, sd.canonical_domain
            {_BASE_QUERY}
            """
        )
    ).all()

    source_counts = Counter(row.match_source for row in rows)
    outstanding_by_currency: dict[str, Decimal] = {}
    vendors: set[str] = set()

    for row in rows:
        vendors.add(row.canonical_domain)
        amount = row.remaining_amount if row.remaining_amount is not None else row.amount
        if amount is not None:
            currency = row.currency or "—"
            outstanding_by_currency[currency] = outstanding_by_currency.get(currency, Decimal(0)) + amount

    return {
        "total_line_items": len(rows),
        "total_vendors": len(vendors),
        "by_match_source": {
            "smartpal": source_counts.get("SMARTPAL", 0),
            "pir": source_counts.get("PIR", 0),
            "invoice_mail": source_counts.get("INVOICE_MAIL", 0),
            "none_": source_counts.get("NONE", 0),
        },
        "needs_triage_count": source_counts.get("NONE", 0),
        "total_outstanding_by_currency": outstanding_by_currency,
    }


@router.post("/rematch", response_model=SoaRematchResult)
def rematch_soa_entries(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
    __: User = Depends(require_module_access("soa")),
) -> dict:
    """Re-runs matching against the current state of smartpal_invoice_entries/pir_entries/
    invoice_mail_entries without waiting for the next mail poll — a line item's match can change
    even when no new SOA has arrived (e.g. an invoice moves from Pending to Finally Approved in
    SmartPAL). Not audit-logged: this recomputes derived fields, it isn't a user editing a
    specific record (same stance as pi_entries' days_since_payment auto-refresh)."""
    count = rematch_all_current_line_items(db)
    return {"matched_count": count}
