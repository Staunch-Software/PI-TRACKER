from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.dashboard import DashboardKpisOut, OverdueEntryOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_KPI_QUERY = """
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE followup_status = 'RECEIVED') AS received,
      count(*) FILTER (WHERE followup_status = 'PENDING_NOT_YET_FOLLOWED_UP') AS not_followed_up,
      count(*) FILTER (WHERE followup_status = 'PENDING_REMINDER_SENT') AS reminder_sent,
      count(*) FILTER (WHERE followup_status = 'PENDING_INTERNAL_CHECK') AS internal_check,
      count(*) FILTER (WHERE followup_status = 'PENDING_DISCREPANCY_TO_RESOLVE') AS discrepancy,
      count(*) FILTER (WHERE followup_status = 'PENDING_SCHEDULED') AS scheduled,
      count(*) FILTER (WHERE followup_status = 'PENDING_OTHER') AS other,
      count(*) FILTER (WHERE followup_status = 'NOT_APPLICABLE') AS not_applicable,
      count(*) FILTER (
        WHERE (CURRENT_DATE - payment_date) > 30
          AND followup_status NOT IN ('RECEIVED', 'NOT_APPLICABLE')
      ) AS overdue30_plus
    FROM pi_entries
"""

_OVERDUE_QUERY = """
    SELECT pe.id, pe.dpr_no, v.name AS vessel_name, ve.name AS vendor_name, pe.amount_inr, pe.currency,
           (CURRENT_DATE - pe.payment_date) AS days_since_payment, pe.followup_status
    FROM pi_entries pe
    JOIN vessels v ON v.id = pe.vessel_id
    JOIN vendors ve ON ve.id = pe.vendor_id
    WHERE (CURRENT_DATE - pe.payment_date) > 30
      AND pe.followup_status NOT IN ('RECEIVED', 'NOT_APPLICABLE')
    ORDER BY days_since_payment DESC
    LIMIT :limit
"""


@router.get("/kpis", response_model=DashboardKpisOut)
def get_dashboard_kpis(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> dict:
    row = db.execute(text(_KPI_QUERY)).mappings().first()
    return dict(row)


@router.get("/overdue", response_model=list[OverdueEntryOut])
def get_overdue_entries(
    db: Session = Depends(get_db), _: User = Depends(get_current_user), limit: int = Query(default=10, ge=1, le=50)
) -> list[dict]:
    rows = db.execute(text(_OVERDUE_QUERY), {"limit": limit}).mappings().all()
    return [dict(row) for row in rows]
