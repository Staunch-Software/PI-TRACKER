# ===========================================================================
# backend/app/services/soa_scraper/line_item_extractor.py
#
# Deterministic (header-keyword-driven) replacement for the old Ollama-based extraction
# (ollama_extractor.py, removed) — no LLM, no model storage on the VM. Works against the
# STRUCTURED tables table_extraction.py pulls out of the email body/attachments.
#
# Trade-off accepted per user: a vendor format with no recognizable header row (e.g. a layout
# that names columns in a way none of the keyword lists below catch, or buries line items in
# prose rather than a table at all) won't extract any line items here, where the old LLM step
# might have. See ingest.py's "UNPARSED-..." placeholder line item for how that's surfaced
# instead of silently dropping the document.
# ===========================================================================
import logging
import re
from dataclasses import dataclass
from datetime import date

from dateutil import parser as dateutil_parser

from app.services.pir_vessel_matcher import normalize_vessel_name
from app.services.soa_scraper.normalize import normalize_invoice_number
from app.services.soa_scraper.table_extraction import Table

log = logging.getLogger(__name__)

_HEADER_KEYWORDS: dict[str, list[str]] = {
    # "transaction#"/"txn" must be checked before a looser "reference" match can steal the slot:
    # a ledger-export vendor (confirmed live) has BOTH a "Transaction#" column (the real invoice
    # number) and a separate "Reference#" column (the PO number) — without recognizing
    # "Transaction#" at all, "Reference#" was the only invoice_number-shaped header found, so
    # every line item got the PO number stored as its invoice number instead. This relies on
    # Transaction# sitting to the LEFT of Reference# in that export (confirmed), since whichever
    # column is evaluated first (ascending column index) claims the field — see _detect_header.
    "invoice_number": ["transaction#", "transaction no", "txn#", "txn no", "invoice no", "invoice number",
                        "inv no", "inv.no", "inv#", "reference no", "reference", "ref no", "voucher no",
                        "voucher", "bill no", "document no"],
    "invoice_date": ["invoice date", "inv date", "bill date", "document date", "date"],
    # "total" (the same ledger export's "Total (FCY)" column — confirmed live) covers a vendor
    # that labels the original amount with no "amount"/"invoice amount" wording at all.
    "amount": ["invoice amount", "gross amount", "total amount", "total", "amount", "value", "debit"],
    # "remaining amount"/"remaining" must come before the bare "amount" keyword wins by accident
    # (checked in _FIELD_ORDER, not list order, but still: without this, a "Remaining Amount"
    # header only matches on the substring "amount" and collides with a real Amount column —
    # confirmed live on Den-Jet's export, which has both, and whose "Balance" column — matched
    # here too — is a running cumulative total, NOT the per-invoice remaining balance). "amt" (Ket
    # Marine's "Open_amt" — confirmed live) covers the common abbreviated spelling; an "open"/"due"
    # amount is by definition still outstanding, so it's treated as remaining_amount, not amount.
    "remaining_amount": ["remaining amount", "remaining", "balance", "outstanding", "o/s amount",
                          "os amount", "due amount", "net due", "unpaid", "amt"],
    "currency": ["currency", "curr"],
    "vessel": ["vessel", "ship", "vessel name"],
}

# Matched by exact cell equality (after strip/lower), never substring — for terse single-word
# headers that would false-positive as a substring of something unrelated (a bare "num" would
# also match inside "item number", "numeric code", etc; bare "invoice" would also match inside
# "invoice date"/"invoice amount", which must stay their own fields).
_EXACT_HEADER_KEYWORDS: dict[str, list[str]] = {
    # QuickBooks-style exports (Navarino — confirmed live) label the invoice/document number
    # column just "Num"; Ket Marine International's export (confirmed live) labels it just
    # "Invoice" with no "No."/"Number" suffix at all.
    "invoice_number": ["num", "invoice"],
    # Ket Marine International's export (confirmed live) abbreviates the currency column to
    # "Cur" — one letter short of the existing substring keyword "curr", so it needs its own
    # exact entry rather than widening "curr" to a substring risking false positives elsewhere.
    "currency": ["cur"],
}

# Checked in this order — a header cell matching an earlier field "wins" so e.g. "invoice date"
# doesn't also get claimed by the bare "date" keyword meant as a last-resort fallback.
_FIELD_ORDER = ["invoice_number", "invoice_date", "remaining_amount", "amount", "currency", "vessel"]

_TOTALS_ROW_RE = re.compile(r"^\s*(grand\s+)?(sub[\s-]?)?total\b", re.IGNORECASE)

_KNOWN_CURRENCY_CODES = ["USD", "EUR", "INR", "SGD", "AED", "GBP"]
_CURRENCY_RE = re.compile(r"\b(" + "|".join(_KNOWN_CURRENCY_CODES) + r")\b")

_VESSEL_CONTEXT_RE = re.compile(
    r"(?:(?:owners?\s+of\s+)?vessel|m[./]?v\.?)\s*[:\-]?\s*\"?([A-Z][A-Za-z0-9 .\-]{2,40})\"?",
    re.IGNORECASE,
)

_AMOUNT_CLEAN_RE = re.compile(r"[^\d.\-]")
_MIN_HEADER_COLUMNS_FOR_AMOUNT = {"amount", "remaining_amount"}


@dataclass
class ExtractedLineItem:
    invoice_number: str
    invoice_date: str | None
    amount: float | None
    remaining_amount: float | None
    currency: str | None
    vessel_name: str | None


def _match_field(header_cell: str) -> str | None:
    cell = header_cell.strip().lower()
    if not cell:
        return None
    for field_name in _FIELD_ORDER:
        if cell in _EXACT_HEADER_KEYWORDS.get(field_name, []):
            return field_name
    for field_name in _FIELD_ORDER:
        if any(kw in cell for kw in _HEADER_KEYWORDS[field_name]):
            return field_name
    return None


def _detect_header(rows: list[list[str]], max_header_rows: int = 20) -> tuple[int, dict[int, str]] | None:
    """Scans the first rows for the best-looking header row. Requires an invoice_number column
    AND at least one of amount/remaining_amount to accept a table as a line-item table — guards
    against matching an unrelated table (e.g. a bank-details block, a signature table). The
    window is wider than "a header is usually near the top" would suggest because real vendor
    SOA Excel exports (Den-Jet, Navarino — confirmed live) put several rows of company
    letterhead/branding ahead of the actual column headers."""
    best: tuple[int, dict[int, str]] | None = None
    for row_idx, row in enumerate(rows[:max_header_rows]):
        column_map: dict[int, str] = {}
        for col_idx, cell in enumerate(row):
            field_name = _match_field(cell)
            if field_name and field_name not in column_map.values():
                column_map[col_idx] = field_name
        fields_found = set(column_map.values())
        if "invoice_number" in fields_found and (fields_found & _MIN_HEADER_COLUMNS_FOR_AMOUNT):
            if best is None or len(column_map) > len(best[1]):
                best = (row_idx, column_map)
    return best


def _parse_amount(raw: str | None) -> float | None:
    if not raw:
        return None
    raw = raw.strip()
    if not raw:
        return None
    negative = raw.startswith("(") and raw.endswith(")")
    is_credit = bool(re.search(r"\bCR\b", raw, re.IGNORECASE))
    cleaned = _AMOUNT_CLEAN_RE.sub("", raw)
    if not cleaned or cleaned in ("-", "."):
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if negative or is_credit:
        value = -abs(value)
    return value


_ISO_DATE_PREFIX_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _parse_date(raw: str | None) -> str | None:
    """Tries unambiguous ISO (YYYY-MM-DD, with or without a trailing time-of-day — confirmed live:
    Navarino's QuickBooks export writes "2026-08-01 00:00:00") first — dateutil's dayfirst=True
    below would otherwise happily swap day/month on an already-unambiguous ISO date (confirmed:
    both "2026-07-10" and "2026-08-01 00:00:00" with dayfirst=True parse with day/month swapped).
    Falls back to dateutil for every other vendor format (DD/MM/YYYY, DD-Mon-YYYY, etc.), where
    dayfirst is the right default for this business."""
    if not raw or not raw.strip():
        return None
    raw = raw.strip()
    iso_match = _ISO_DATE_PREFIX_RE.match(raw)
    if iso_match:
        try:
            return date.fromisoformat(iso_match.group(1)).isoformat()
        except ValueError:
            return None
    try:
        return dateutil_parser.parse(raw, dayfirst=True, fuzzy=True).date().isoformat()
    except (ValueError, OverflowError):
        return None


def _detect_currency(row: list[str]) -> str | None:
    for cell in row:
        match = _CURRENCY_RE.search(cell or "")
        if match:
            return match.group(1).upper()
    return None


_MIN_VESSEL_SUBSTRING_LEN = 4
# Only a short context (a sheet title, a one-line heading) is eligible for the bare-name fallback
# below — a long paragraph matching a vessel name as a substring is far more likely to be a
# coincidence, and returning the whole paragraph back as vessel_name_raw would be nonsense anyway.
_MAX_CONTEXT_LEN_FOR_BARE_NAME_FALLBACK = 60


def _find_vessel(text: str, vessel_lookup: dict[str, str]) -> str | None:
    """Only ever returns a name that's actually in our fleet (a value from vessel_lookup, keyed by
    normalized name) — never invents one from arbitrary free text, and always returns the DB's own
    canonical spelling rather than however the source text happened to write it. Covers
    'To Master/Owners of Vessel "X"' style context text (Den-Jet — confirmed live) as well as a
    short context that just IS the vessel name (e.g. a per-vessel worksheet titled "AMNS POLAR"
    with no "Vessel:" keyword at all), and a per-row vessel-column cell that embeds the same
    free-text phrasing around the name rather than naming it alone (e.g. "Master & Owners of AM
    UMANG" — Den-Jet, confirmed live — has no literal word "Vessel" at all, so it never matches
    the regex above and relies on the substring fallback below; returning the whole phrase there
    instead of just "AM UMANG" would be wrong)."""
    if not text:
        return None

    for match in _VESSEL_CONTEXT_RE.finditer(text):
        candidate = match.group(1).strip()
        key = normalize_vessel_name(candidate)
        if key in vessel_lookup:
            return vessel_lookup[key]

    stripped = text.strip()
    if stripped and len(stripped) <= _MAX_CONTEXT_LEN_FOR_BARE_NAME_FALLBACK:
        normalized_text = normalize_vessel_name(stripped)
        if len(normalized_text) >= _MIN_VESSEL_SUBSTRING_LEN:
            matches = [
                key for key in vessel_lookup
                if len(key) >= _MIN_VESSEL_SUBSTRING_LEN and (key in normalized_text or normalized_text in key)
            ]
            if len(matches) == 1:  # ambiguous (matches >1) is deliberately not guessed at
                return vessel_lookup[matches[0]]
    return None


# Some vendor exports (Den-Jet — confirmed live) anchor a merged header cell's text at a
# different column than the single data cell beneath it — "Inv No" sits at column 7 while the
# actual invoice numbers are at column 5, same for "Date"/"PO No", apparently because their
# accounting software writes a merged header's value somewhere other than the merge's top-left
# cell. A few genuinely single-column headers (Amount/Balance/Vessel Name) line up exactly, so
# this only kicks in as a fallback when the header's own column is blank in a given data row.
_COLUMN_ALIGNMENT_WINDOW = 3


def _row_value(row: list[str], col_idx: int, claimed: set[int]) -> str:
    if col_idx < len(row) and row[col_idx].strip() and col_idx not in claimed:
        claimed.add(col_idx)
        return row[col_idx]
    for offset in range(1, _COLUMN_ALIGNMENT_WINDOW + 1):
        left = col_idx - offset
        if 0 <= left < len(row) and row[left].strip() and left not in claimed:
            claimed.add(left)
            return row[left]
    return ""


def extract_line_items(tables: list[Table], known_vessel_names: list[str]) -> list[ExtractedLineItem]:
    # Normalized name -> canonical DB spelling, so a match is always reported in the fleet's own
    # casing regardless of how a vendor's source text happened to write it.
    vessel_lookup = {normalize_vessel_name(n): n for n in known_vessel_names}
    items: list[ExtractedLineItem] = []

    for table in tables:
        detected = _detect_header(table.rows)
        if not detected:
            continue
        header_idx, column_map = detected
        context_vessel = _find_vessel(table.context_text, vessel_lookup)

        for row in table.rows[header_idx + 1:]:
            if not any(c.strip() for c in row):
                continue
            if row and _TOTALS_ROW_RE.match(row[0] or ""):
                continue

            claimed: set[int] = set()
            values: dict[str, str] = {}
            for col_idx, field_name in column_map.items():
                values[field_name] = _row_value(row, col_idx, claimed)

            invoice_number = (values.get("invoice_number") or "").strip()
            if not invoice_number:
                continue

            amount = _parse_amount(values.get("amount"))
            remaining_amount = _parse_amount(values.get("remaining_amount"))
            if remaining_amount is None:
                remaining_amount = amount

            currency = (values.get("currency") or "").strip().upper() or None
            if currency and currency not in _KNOWN_CURRENCY_CODES:
                currency = None
            if not currency:
                currency = _detect_currency(row)

            # Goes through _find_vessel, not a bare equality check, since a vendor's own "Vessel
            # Name" column can itself hold the same free-text phrasing as the table's
            # context_text (e.g. 'To Master/Owners of Vessel "GCL NARMADA"' — Den-Jet, confirmed
            # live), not just a clean bare name.
            vessel_cell = (values.get("vessel") or "").strip()
            vessel_name = _find_vessel(vessel_cell, vessel_lookup) if vessel_cell else None
            if not vessel_name:
                vessel_name = context_vessel

            items.append(
                ExtractedLineItem(
                    invoice_number=invoice_number,
                    invoice_date=_parse_date(values.get("invoice_date")),
                    amount=amount,
                    remaining_amount=remaining_amount,
                    currency=currency,
                    vessel_name=vessel_name,
                )
            )

        log.debug("Parsed %d line item(s) from %s", len(items), table.source)

    return _dedupe_by_invoice_number(items)


def _dedupe_by_invoice_number(items: list[ExtractedLineItem]) -> list[ExtractedLineItem]:
    """Outlook quotes the entire prior thread in a reply's body, and html_tables() has no way to
    tell "this reply's own content" apart from "the old table quoted below it" — so a vendor who
    sends an inline-HTML-table SOA and replies in the SAME thread with an update would otherwise
    have both the new AND the stale quoted table extracted, duplicating/conflicting line items
    within one document. Keeps the FIRST occurrence of a given invoice number (top-posting is the
    overwhelmingly common convention, so the newest content is normally what appears first)."""
    seen: set[str] = set()
    deduped = []
    for item in items:
        key = normalize_invoice_number(item.invoice_number)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    if len(deduped) != len(items):
        log.info("Dropped %d duplicate invoice number(s) within the same document", len(items) - len(deduped))
    return deduped
