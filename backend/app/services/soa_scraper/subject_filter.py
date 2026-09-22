# ===========================================================================
# backend/app/services/soa_scraper/subject_filter.py
#
# Cheap pre-filter run BEFORE the expensive Ollama extraction call, so ingest.py doesn't burn
# minutes-per-message running full extraction against every unrelated email in what are mostly
# ordinary people's inboxes (sunilkumar.s@, Karunya.pius@, viswanathan.n@ozellar.com — confirmed
# live these also receive CVs, RFQs, FDA notices, etc., not just SOA/invoice mail).
#
# Keyword match on subject only — cheap, instant, no LLM cost. Keywords are drawn from real
# subjects confirmed live: "DEN-JET MARINE_OZELLAR_SOA 18092026", "RE: Follow-Up on Outstanding
# Overdue Balance – USD 14,992.47", "RE: OZELLAR GLOBAL PTE LTD - PAYMENT REMINDER", "CIA
# Notification // Final Reminder // RE: OZELLAR GLOBAL PTE LTD SOA 09MAR2026", "RE: Ozellar
# Invoices soft copies Part - 1". Trade-off accepted per user: may miss an SOA/invoice with an
# unusual subject line, in exchange for never running extraction against obviously-unrelated mail.
# ===========================================================================
import re

_SOA_SUBJECT_KEYWORDS = [
    "soa",
    "statement of account",
    "statement of accounts",
    "outstanding",
    "overdue",
    "payment reminder",
    "o/s payment",
    "o/s balance",
    "account statement",
    "final reminder",
    "cash-in-advance",
    "cia notification",
]

_INVOICE_SUBJECT_KEYWORDS = [
    "invoice",
    "invoices",
    "inv no",
    "billing",
]


def _matches_any(subject: str, keywords: list[str]) -> bool:
    subject_lower = (subject or "").lower()
    return any(re.search(re.escape(kw), subject_lower) for kw in keywords)


def looks_like_soa_subject(subject: str) -> bool:
    return _matches_any(subject, _SOA_SUBJECT_KEYWORDS)


def looks_like_invoice_subject(subject: str) -> bool:
    return _matches_any(subject, _INVOICE_SUBJECT_KEYWORDS)
