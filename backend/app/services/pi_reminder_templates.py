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
from typing import Literal, TYPE_CHECKING

from app.core.enums import FollowUpStatus, FOLLOW_UP_STATUS_LABELS

if TYPE_CHECKING:
    from app.models.vendor_bank_detail import VendorBankDetail


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


def bank_details_request_email(*, vendor_name: str, missing_fields: list[str]) -> tuple[str, str]:
    """Returns (subject, html_body). Goes to the VENDOR — asks THEM to send us their bank details
    on THEIR OWN company letterhead, signed by an authorized signatory (standard anti-fraud
    bank-mandate verification practice) — confirmed with the user 2026-10-30 this needs no
    letterhead/branding of our own, just a plain request explaining what to send.

    missing_fields (confirmed 2026-11-04): only the fields SmartPAL's own Bank Details tab doesn't
    already have for this vendor are listed — a vendor with every field already on file never gets
    this email at all (the frontend hides the "Send Bank Details Request" action in that case), but
    this still falls back to asking for all 6 if somehow called with an empty list, rather than
    sending a request that asks for nothing."""
    fields = missing_fields or [
        "Beneficiary Name", "Bank Name", "Branch Name", "Account Number", "IBAN", "Swift Code",
    ]
    items = "\n".join(f"      <li>{field}</li>" for field in fields)
    subject = f"Request for Bank Details – {vendor_name}"
    body = f"""
    <p>Dear {vendor_name} Team,</p>
    <p>As part of our standard vendor verification process, we request you to share your bank
    account details on your company's official letterhead, duly signed by an authorized
    signatory. Please include the following details:</p>
    <ul>
{items}
    </ul>
    <p>Kindly also attach supporting proof such as a cancelled cheque or a bank confirmation letter.</p>
    <p>Thank you,<br>Purchase Team</p>
    """
    return subject, body


def verification_reminder_email(
    *,
    vendor_name: str,
    bank_row: "VendorBankDetail | None",
    vendor_email: str | None = None,
    vendor_phone: str | None = None,
    vendor_address: str | None = None,
) -> tuple[str, str]:
    """Returns (subject, html_body). Goes to accounts payable — these are the bank details we
    received FROM the vendor (already scraped into vendor_bank_details from SmartPAL's own Bank
    Details tab), asking them to verify it from their side before any payment is processed against
    it. Only ever called once that bank row is confirmed complete (see
    api/routes/vendor_management.py's _pal_bank_completeness / the "Send Verification Reminder"
    button's disabled state), so bank_row is never None in practice, but the fallback below keeps
    this safe to call defensively.

    Deliberately NOT an HTML <table> (confirmed 2026-11-04 the prior version broke once sent): the
    frontend's editable preview/edit modal round-trips this body through a plain-text conversion
    before sending (same pattern as bank_details_request_email's modal), and <tr>/<td> don't
    survive that round trip as a table — they degrade to bare label-then-value text with no
    separator. Plain "Label : Value" lines joined by <br> survive that round trip intact and read
    the same editable/sent either way."""
    subject = f"Bank Details Verification Required – {vendor_name}"

    vendor_lines = [
        f"Email : {vendor_email or '—'}",
        f"Phone : {vendor_phone or '—'}",
        f"Address : {vendor_address or '—'}",
    ]
    if bank_row:
        bank_lines = [
            f"Beneficiary Name : {bank_row.beneficiary_name or '—'}",
            f"Bank Name : {bank_row.bank_name or '—'}",
            f"Branch Name : {bank_row.branch_name or '—'}",
            f"Account Number : {bank_row.account_number or '—'}",
            f"IBAN : {bank_row.iban or '—'}",
            f"Swift Code : {bank_row.swift_code or '—'}",
        ]
    else:
        bank_lines = ["No bank details on file."]

    vendor_block = "<br>".join(vendor_lines)
    bank_block = "<br>".join(bank_lines)
    body = f"""
    <p>Dear Team,</p>
    <p>These are the bank details we received from <b>{vendor_name}</b>. Kindly verify them from
    your side before they are used for any payment.</p>
    <p><b>Vendor Details</b><br>
    {vendor_block}</p>
    <p><b>Bank Details</b><br>
    {bank_block}</p>
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
    pi_number: str | None = None,
) -> tuple[str, str]:
    """Returns (subject, html_body). Goes to the OWNER — full details, asks for a status update."""
    subject = f"Follow-up Required – PI {dpr_no or '(pending)'} – {vessel_name} / {vendor_name}"
    if pi_number:
        subject += f" - {pi_number}"
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
