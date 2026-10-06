from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_user_activity_access
from app.db.session import get_db
from app.models.user import User
from app.schemas.invoice_registration import InvoiceRegistrationDailyEntry, InvoiceRegistrationSummaryEntry

router = APIRouter(prefix="/invoice-registrations", tags=["invoice-registrations"])


@router.get("/summary", response_model=list[InvoiceRegistrationSummaryEntry])
def get_registration_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_activity_access),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[dict]:
    """Counts of registered invoices grouped by who registered them, optionally filtered to a
    registered_action_date range — feeds the "Registered By" panel on the PIR page."""
    where_clauses = ["registered_by IS NOT NULL"]
    params: dict = {}
    if date_from:
        where_clauses.append("registered_action_date::date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("registered_action_date::date <= :date_to")
        params["date_to"] = date_to

    where_sql = f"WHERE {' AND '.join(where_clauses)}"
    rows = db.execute(
        text(
            f"""
            SELECT registered_by, count(*) AS count
            FROM invoice_registrations
            {where_sql}
            GROUP BY registered_by
            ORDER BY count DESC, registered_by ASC
            """
        ),
        params,
    ).mappings().all()

    return [dict(row) for row in rows]


@router.get("/daily", response_model=list[InvoiceRegistrationDailyEntry])
def get_registration_daily(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_activity_access),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[dict]:
    """Counts of registered invoices grouped by (day, registered_by) — feeds the daily trend
    chart in the "User Activity" modal's Registered-by tab."""
    where_clauses = ["registered_by IS NOT NULL", "registered_action_date IS NOT NULL"]
    params: dict = {}
    if date_from:
        where_clauses.append("registered_action_date::date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("registered_action_date::date <= :date_to")
        params["date_to"] = date_to

    where_sql = f"WHERE {' AND '.join(where_clauses)}"
    rows = db.execute(
        text(
            f"""
            SELECT registered_action_date::date AS date, registered_by, count(*) AS count
            FROM invoice_registrations
            {where_sql}
            GROUP BY registered_action_date::date, registered_by
            ORDER BY date ASC, registered_by ASC
            """
        ),
        params,
    ).mappings().all()

    return [dict(row) for row in rows]
