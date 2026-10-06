from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import USER_ACTIVITY_ALLOWED_EMAILS, require_user_activity_access
from app.db.session import get_db
from app.models.user import User
from app.services.pi_reminder_mailer import send_mail
from app.services.user_activity_report_template import user_activity_report_email

router = APIRouter(prefix="/user-activity", tags=["user-activity"])


@router.post("/report")
def send_user_activity_report(
    db: Session = Depends(get_db),
    _: User = Depends(require_user_activity_access),
) -> dict:
    """Emails the same allowlisted recipients (see require_user_activity_access) a combined
    Registered-by/Rejected-by count summary for the last 7 days — fixed range, independent of
    whatever date filter is currently set in the "User Activity" modal, since this is meant to be
    a quick weekly snapshot rather than a re-send of whatever's on screen."""
    date_to = date.today()
    date_from = date_to - timedelta(days=7)

    registered_summary = [
        dict(row)
        for row in db.execute(
            text(
                """
                SELECT registered_by, count(*) AS count
                FROM invoice_registrations
                WHERE registered_by IS NOT NULL
                  AND registered_action_date::date >= :date_from
                  AND registered_action_date::date <= :date_to
                GROUP BY registered_by
                ORDER BY count DESC, registered_by ASC
                """
            ),
            {"date_from": date_from, "date_to": date_to},
        ).mappings().all()
    ]

    rejected_summary = [
        dict(row)
        for row in db.execute(
            text(
                """
                SELECT rejected_by, count(*) AS count
                FROM pir_rejections
                WHERE rejected_by IS NOT NULL
                  AND rejected_date::date >= :date_from
                  AND rejected_date::date <= :date_to
                GROUP BY rejected_by
                ORDER BY count DESC, rejected_by ASC
                """
            ),
            {"date_from": date_from, "date_to": date_to},
        ).mappings().all()
    ]

    subject, body = user_activity_report_email(
        date_from=date_from,
        date_to=date_to,
        registered_summary=registered_summary,
        rejected_summary=rejected_summary,
    )

    try:
        send_mail(sorted(USER_ACTIVITY_ALLOWED_EMAILS), subject, body)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to send email: {e}") from e

    return {"sent": True, "dateFrom": date_from, "dateTo": date_to}
