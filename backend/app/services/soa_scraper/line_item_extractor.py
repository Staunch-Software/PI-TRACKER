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
from app.services.soa_scraper.table_extraction import Table

log = logging.getLogger(__name__)

_HEADER_KEYWORDS: dict[str, list[str]] = {
    "invoice_number": ["invoice no", "invoice number", "inv no", "inv.no", "inv#", "reference no",
                        "reference", "ref no", "voucher no", "voucher", "bill no", "document no"],
    "invoice_date": ["invoice date", "inv date", "bill date", "document date", "date"],
    "amount": ["invoice amount", "gross amount", "total amount", "amount", "value", "debit"],
    "remaining_amount": ["balance", "outstanding", "o/s amount", "os amount", "due amount", "net due", "unpaid"],
    "currency": ["currency", "curr"],
    "vessel": ["vessel", "ship", "vessel name"],
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


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _parse_date(raw: str | None) -> str | None:
    """Tries unambiguous ISO (YYYY-MM-DD) first — dateutil's dayfirst=True below would otherwise
    happily swap day/month on an already-unambiguous ISO string (confirmed: "2026-07-10" with
    dayfirst=True parses as 2026-10-07). Falls back to dateutil for every other vendor format
    (DD/MM/YYYY, DD-Mon-YYYY, etc.), where dayfirst is the right default for this business."""
    if not raw or not raw.strip():
        return None
    raw = raw.strip()
    if _ISO_DATE_RE.match(raw):
        try:
            return date.fromisoformat(raw).isoformat()
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


def _find_vessel(text: str, known_vessel_names_normalized: set[str]) -> str | None:
    """Only ever returns a name that's actually in our fleet (known_vessel_names_normalized) —
    never invents one from arbitrary free text. Covers 'To Master/Owners of Vessel "X"' style
    context text (Den-Jet — confirmed live) as well as a short context that just IS the vessel
    name (e.g. a per-vessel worksheet titled "AMNS POLAR" with no "Vessel:" keyword at all)."""
    if not text:
        return None

    for match in _VESSEL_CONTEXT_RE.finditer(text):
        candidate = match.group(1).strip()
        if normalize_vessel_name(candidate) in known_vessel_names_normalized:
            return candidate

    stripped = text.strip()
    if stripped and len(stripped) <= _MAX_CONTEXT_LEN_FOR_BARE_NAME_FALLBACK:
        normalized_text = normalize_vessel_name(stripped)
        if len(normalized_text) >= _MIN_VESSEL_SUBSTRING_LEN:
            matches = [
                n for n in known_vessel_names_normalized
                if len(n) >= _MIN_VESSEL_SUBSTRING_LEN and (n in normalized_text or normalized_text in n)
            ]
            if len(matches) == 1:  # ambiguous (matches >1) is deliberately not guessed at
                return stripped
    return None


def extract_line_items(tables: list[Table], known_vessel_names: list[str]) -> list[ExtractedLineItem]:
    known_vessel_names_normalized = {normalize_vessel_name(n) for n in known_vessel_names}
    items: list[ExtractedLineItem] = []

    for table in tables:
        detected = _detect_header(table.rows)
        if not detected:
            continue
        header_idx, column_map = detected
        context_vessel = _find_vessel(table.context_text, known_vessel_names_normalized)

        for row in table.rows[header_idx + 1:]:
            if not any(c.strip() for c in row):
                continue
            if row and _TOTALS_ROW_RE.match(row[0] or ""):
                continue

            values: dict[str, str] = {}
            for col_idx, field_name in column_map.items():
                if col_idx < len(row):
                    values[field_name] = row[col_idx]

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

            vessel_name = (values.get("vessel") or "").strip() or None
            if vessel_name and normalize_vessel_name(vessel_name) not in known_vessel_names_normalized:
                vessel_name = None
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

    return items
