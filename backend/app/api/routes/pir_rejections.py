from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_user_activity_access
from app.db.session import get_db
from app.models.user import User
from app.schemas.pir_rejection import PirRejectionDailyEntry, PirRejectionSummaryEntry

router = APIRouter(prefix="/pir-rejections", tags=["pir-rejections"])


@router.get("/summary", response_model=list[PirRejectionSummaryEntry])
def get_rejection_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_activity_access),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[dict]:
    """Counts of rejected PIR invoices grouped by who rejected them, optionally filtered to a
    rejected_date range — feeds the "Rejected By" panel on the PIR page."""
    where_clauses = ["rejected_by IS NOT NULL"]
    params: dict = {}
    if date_from:
        where_clauses.append("rejected_date::date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("rejected_date::date <= :date_to")
        params["date_to"] = date_to

    where_sql = f"WHERE {' AND '.join(where_clauses)}"
    rows = db.execute(
        text(
            f"""
            SELECT rejected_by, count(*) AS count
            FROM pir_rejections
            {where_sql}
            GROUP BY rejected_by
            ORDER BY count DESC, rejected_by ASC
            """
        ),
        params,
    ).mappings().all()

    return [dict(row) for row in rows]


@router.get("/daily", response_model=list[PirRejectionDailyEntry])
def get_rejection_daily(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_activity_access),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
) -> list[dict]:
    """Counts of rejected PIR invoices grouped by (day, rejected_by) — feeds the daily trend
    chart in the "User Activity" modal's Rejected-by tab."""
    where_clauses = ["rejected_by IS NOT NULL", "rejected_date IS NOT NULL"]
    params: dict = {}
    if date_from:
        where_clauses.append("rejected_date::date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        where_clauses.append("rejected_date::date <= :date_to")
        params["date_to"] = date_to

    where_sql = f"WHERE {' AND '.join(where_clauses)}"
    rows = db.execute(
        text(
            f"""
            SELECT rejected_date::date AS date, rejected_by, count(*) AS count
            FROM pir_rejections
            {where_sql}
            GROUP BY rejected_date::date, rejected_by
            ORDER BY date ASC, rejected_by ASC
            """
        ),
        params,
    ).mappings().all()

    return [dict(row) for row in rows]
