import re
from datetime import date, datetime


def normalize_invoice_number(raw: str) -> str:
    """Case/whitespace/leading-zero-insensitive key for matching an SOA line item's invoice
    number against smartpal_invoice_entries / pir_entries / invoice_mail_entries. Strips
    everything but alphanumerics, uppercases, then strips leading zeros (numeric invoice numbers
    are sometimes zero-padded inconsistently between a vendor's SOA and SmartPAL's own record of
    the same invoice)."""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw or "").upper()
    stripped = cleaned.lstrip("0")
    return stripped or cleaned


def extract_domain(email: str) -> str:
    email = (email or "").strip().lower()
    return email.split("@", 1)[1] if "@" in email else email


def parse_iso_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw[:10]).date()
    except ValueError:
        return None
