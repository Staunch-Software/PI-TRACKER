import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.approved_invoice_entry import ApprovedInvoiceEntry
from app.models.user import User
from app.schemas.approved_invoice_entry import ApprovedInvoiceEntryOut, UpdatePaymentStatusRequest
from app.schemas.common import PaginatedResult
from app.services.audit import write_audit_log

router = APIRouter(prefix="/approved-invoices", tags=["approved-invoices"])

# Whitelisted sort columns (frontend key -> safe SQL expression) — same convention as
# pi_entries.py's _SORTABLE_COLUMNS; never interpolate sort_by directly into SQL.
_SORTABLE_COLUMNS = {
    "invoiceNo": "invoice_no",
    "vendorName": "vendor_name",
    "vesselName": "vessel_name",
    "amount": "amount",
    "invoiceDate": "invoice_date",
    "forwardDate": "forward_date",
    "paymentStatus": "payment_status",
}


def _build_where_clause(search: str | None, vessel_id: uuid.UUID | None, payment_status: str | None) -> tuple[str, dict]:
    where_clauses = []
    params: dict = {}

    if search:
        where_clauses.append(
            "(invoice_no ILIKE :search OR vendor_name ILIKE :search OR vessel_name ILIKE :search OR po_nos ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    if vessel_id:
        where_clauses.append("vessel_id = :vessel_id")
        params["vessel_id"] = str(vessel_id)
    if payment_status:
        where_clauses.append("payment_status = :payment_status")
        params["payment_status"] = payment_status

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    return where_sql, params


@router.get("", response_model=PaginatedResult[ApprovedInvoiceEntryOut])
def list_approved_invoices(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    search: str | None = Query(default=None),
    vessel_id: uuid.UUID | None = Query(default=None),
    payment_status: str | None = Query(default=None, description="PAID | NOT_PAID"),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> dict:
    where_sql, params = _build_where_clause(search, vessel_id, payment_status)

    total = db.execute(
        text(f"SELECT count(*) FROM approved_invoice_entries {where_sql}"), params
    ).scalar_one()

    if sort_by and sort_by in _SORTABLE_COLUMNS:
        order_sql = f"ORDER BY {_SORTABLE_COLUMNS[sort_by]} {sort_dir.upper()} NULLS LAST, forward_date DESC"
    else:
        # Default: most recently approved invoice first.
        order_sql = "ORDER BY forward_date DESC NULLS LAST, smartpal_invoice_id DESC"

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(
        text(f"SELECT * FROM approved_invoice_entries {where_sql} {order_sql} LIMIT :limit OFFSET :offset"),
        params,
    ).mappings().all()

    return {
        "items": [dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/{entry_id}/payment-status", response_model=ApprovedInvoiceEntryOut)
def update_payment_status(
    entry_id: uuid.UUID,
    payload: UpdatePaymentStatusRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> ApprovedInvoiceEntry:
    """The dropdown per row calls this — payment_status is purely app-managed (see
    ApprovedInvoiceEntry's docstring), never overwritten by a re-scrape."""
    entry = db.get(ApprovedInvoiceEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")

    if entry.payment_status != payload.payment_status.value:
        before = entry.payment_status
        entry.payment_status = payload.payment_status.value
        write_audit_log(
            db,
            entity_type=AuditEntityType.APPROVED_INVOICE_ENTRY,
            entity_id=entry.id,
            action=AuditAction.UPDATE,
            changed_by=current_user.id,
            summary=(
                f"{current_user.full_name} marked invoice {entry.invoice_no or entry.id} as "
                f"{payload.payment_status.value} (was {before})"
            ),
            changes={"payment_status": {"before": before, "after": payload.payment_status.value}},
        )

    db.commit()
    db.refresh(entry)
    return entry
