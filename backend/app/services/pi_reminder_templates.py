# ===========================================================================
# backend/app/services/pi_reminder_templates.py
#
# Email content for the two PI Tracker reminder buttons (see api/routes/pi_entries.py
# send-vendor-notice / send-owner-reminder). Templates confirmed with the user before building —
# see PR notes. Kept as plain string templates, not a templating engine, since there are only two
# of them and no user-editable customization was asked for.
# ===========================================================================
from datetime import date
from decimal import Decimal
from typing import Literal

from app.core.enums import FollowUpStatus, FOLLOW_UP_STATUS_LABELS


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d %b %Y") if d else "—"


def _fmt_amount(amount: Decimal | None, currency: Literal["INR", "USD", "EUR"] | None) -> str:
    if amount is None:
        return "—"
    return f"{currency or ''} {amount:,.2f}".strip()


def vendor_notice_email(
    *,
    dpr_no: str | None,
    dpr_date: date | None,
    vessel_name: str,
    vendor_name: str,
    po_number: str | None,
    service_details: str | None,
    amount_inr: Decimal | None,
    fc_amount: Decimal | None,
    currency: Literal["INR", "USD", "EUR"] | None,
) -> tuple[str, str]:
    """Returns (subject, html_body). Goes to the VENDOR — essential details only, short note."""
    subject = f"PI Follow-up – DPR No. {dpr_no or '(pending)'} – {vessel_name} / {vendor_name}"
    amount = _fmt_amount(fc_amount, currency) if fc_amount is not None else _fmt_amount(amount_inr, "INR")
    body = f"""
    <p>Dear {vendor_name} Team,</p>
    <p>Please find below the details of a Proforma Invoice raised against your services.
    Kindly share your final tax invoice with the DN at the earliest.</p>
    <table cellpadding="4" cellspacing="0" style="border-collapse:collapse">
      <tr><td><b>DPR No.</b></td><td>{dpr_no or '—'}</td></tr>
      <tr><td><b>DPR Date</b></td><td>{_fmt_date(dpr_date)}</td></tr>
      <tr><td><b>Vessel</b></td><td>{vessel_name}</td></tr>
      <tr><td><b>PO Number</b></td><td>{po_number or '—'}</td></tr>
      <tr><td><b>Service Details</b></td><td>{service_details or '—'}</td></tr>
      <tr><td><b>Amount</b></td><td>{amount}</td></tr>
    </table>
    <p>Thank you,<br>Purchase Team</p>
    """
    return subject, body


def owner_reminder_email(
    *,
    dpr_no: str | None,
    dpr_date: date | None,
    vessel_name: str,
    vendor_name: str,
    po_number: str | None,
    service_details: str | None,
    amount_inr: Decimal | None,
    fc_amount: Decimal | None,
    currency: Literal["INR", "USD", "EUR"] | None,
    payment_date: date | None,
    followup_status: FollowUpStatus,
    last_known_remark: str | None,
) -> tuple[str, str]:
    """Returns (subject, html_body). Goes to the OWNER — full details, asks for a status update."""
    subject = f"Follow-up Required – PI {dpr_no or '(pending)'} – {vessel_name} / {vendor_name}"
    amount = _fmt_amount(fc_amount, currency) if fc_amount is not None else _fmt_amount(amount_inr, "INR")
    body = f"""
    <p>Dear Team,</p>
    <p>Kindly update the current status of the following PI at your earliest convenience.</p>
    <table cellpadding="4" cellspacing="0" style="border-collapse:collapse">
      <tr><td><b>DPR No.</b></td><td>{dpr_no or '—'}</td></tr>
      <tr><td><b>DPR Date</b></td><td>{_fmt_date(dpr_date)}</td></tr>
      <tr><td><b>Vessel</b></td><td>{vessel_name}</td></tr>
      <tr><td><b>Vendor</b></td><td>{vendor_name}</td></tr>
      <tr><td><b>PO Number</b></td><td>{po_number or '—'}</td></tr>
      <tr><td><b>Service Details</b></td><td>{service_details or '—'}</td></tr>
      <tr><td><b>Amount</b></td><td>{amount}</td></tr>
      <tr><td><b>Payment Date</b></td><td>{_fmt_date(payment_date)}</td></tr>
      <tr><td><b>Follow-up Status</b></td><td>{FOLLOW_UP_STATUS_LABELS[followup_status]}</td></tr>
      <tr><td><b>Last Known Remark</b></td><td>{last_known_remark or '—'}</td></tr>
    </table>
    <p>Please share an update on the payment/approval status.</p>
    <p>Thank you,<br>Purchase Team</p>
    """
    return subject, body
