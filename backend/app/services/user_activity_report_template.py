# ===========================================================================
# backend/app/services/user_activity_report_template.py
#
# Email content for the "User Activity" modal's "Email Report" button (see
# api/routes/user_activity.py) — a weekly Registered-by/Rejected-by count summary. Same plain
# string-template convention as pi_reminder_templates.py, not a templating engine.
# ===========================================================================
from datetime import date


def _fmt_date(d: date) -> str:
    return d.strftime("%d %b %Y")


def _summary_rows(summary: list[dict], person_key: str, cell_style: str) -> str:
    if not summary:
        return f"<tr><td colspan='2' style='{cell_style};color:#64748B'>No activity in this range.</td></tr>"
    return "".join(
        f"<tr><td style='{cell_style}'>{row[person_key]}</td><td style='{cell_style};text-align:right'>{row['count']}</td></tr>"
        for row in summary
    )


def user_activity_report_email(
    *,
    date_from: date,
    date_to: date,
    registered_summary: list[dict],
    rejected_summary: list[dict],
) -> tuple[str, str]:
    """Returns (subject, html_body) — a combined Registered-by / Rejected-by count table for the
    given date range, sent to the same allowlisted recipients who can see the "User Activity"
    modal (see api/deps.py's require_user_activity_access)."""
    subject = f"PIR User Activity Report — {_fmt_date(date_from)} to {_fmt_date(date_to)}"
    table_style = "border-collapse:collapse;min-width:280px"
    header_style = "text-align:left;border-bottom:1px solid #E2E8F0;padding:4px 12px 4px 0"
    cell_style = "padding:4px 12px 4px 0"
    body = f"""
    <p>Dear Team,</p>
    <p>Here is the PIR user-activity summary for <b>{_fmt_date(date_from)}</b> to <b>{_fmt_date(date_to)}</b>.</p>

    <h3 style="margin-bottom:4px">Registered By</h3>
    <table cellpadding="0" cellspacing="0" style="{table_style}">
      <tr><th style="{header_style}">Person</th><th style="{header_style};text-align:right">Count</th></tr>
      {_summary_rows(registered_summary, "registered_by", cell_style)}
    </table>

    <h3 style="margin-bottom:4px;margin-top:20px">Rejected By</h3>
    <table cellpadding="0" cellspacing="0" style="{table_style}">
      <tr><th style="{header_style}">Person</th><th style="{header_style};text-align:right">Count</th></tr>
      {_summary_rows(rejected_summary, "rejected_by", cell_style)}
    </table>

    <p style="margin-top:20px">Thank you,<br>PI Tracker</p>
    """
    return subject, body
