# ===========================================================================
# backend/app/services/soa_scraper/matching.py
#
# Answers, for every CURRENT SOA line item, "where does this invoice live right now, and in
# what state" — checked in priority order (see SoaLineItem model docstring):
#   1. smartpal_invoice_entries, by invoice number (ALL statuses, not just Finally Approved — see
#      that model's docstring; this table is populated by a scraper extension not yet built, so
#      until that lands this source will simply have nothing to match against)
#   2. pir_entries, by invoice number
#   3. invoice_mail_entries, by invoice number
#   4. smartpal_invoice_entries, by FALLBACK match (see below) — only when 1-3 found nothing
#   5. pir_entries, by fallback match — only when 4 found nothing either
#   6. none of the above -> NONE ("No Match", needs triage)
#
# Match key for 1-3 is invoice_number_normalized (see normalize.py) — built as in-memory dicts
# here rather than a SQL join, since PIR's invoice number can live in any of 3 columns
# (invoice_no/reg_invoice_no/vendor_invoice_no) with no stored normalized form to join on, and
# the realistic row counts (thousands, per pir_entries.py's own docstring) make one Python pass
# far simpler than a correct multi-column fuzzy SQL join.
#
# FALLBACK MATCH (4-5): some vendors format an invoice number slightly differently in their own
# SOA than how it landed in SmartPAL/PIR, so an invoice can genuinely exist there with no number
# match at all. The fallback requires, within the SAME vendor: an EXACT amount match (same
# currency when both sides have one), AND an invoice_date within _FALLBACK_DATE_WINDOW_DAYS days.
# "Same vendor" is resolved via sender email DOMAIN (vendors.email / vendor_master_entries.email),
# never by vendor-NAME similarity — see SoaVendorDomainAlias's own docstring on why guessing two
# vendors are "the same" from name similarity is rejected elsewhere in this module; the same
# reasoning applies here. If more than one entry satisfies all three conditions, the match is
# deliberately left ambiguous (NONE) rather than guessed at — same "don't guess" convention as
# pir_vessel_matcher's UNMATCHED_VESSEL_GROUP. A fallback match's match_status_label is suffixed
# "(amount/date match)" so it's visibly distinguishable from an exact invoice-number match in the
# UI (SoaMatchBadge renders match_status_label as-is — no frontend change needed for this).
#
# Re-run via the /api/soa-entries/rematch endpoint (or automatically at the end of an ingestion
# run — see ingest.py) rather than only at ingestion time, since a line item's SmartPAL/PIR state
# can change without any new SOA arriving.
# ===========================================================================
import logging
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.invoice_mail_entry import InvoiceMailEntry
from app.models.pir_entry import PirEntry
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.models.soa_document import SoaDocument
from app.models.soa_line_item import SoaLineItem
from app.models.vendor import Vendor
from app.models.vendor_master_entry import VendorMasterEntry
from app.services.soa_scraper.normalize import extract_domain, normalize_invoice_number
from app.services.vendor_mapping_importer import normalize_vendor_name

log = logging.getLogger(__name__)

_FALLBACK_DATE_WINDOW_DAYS = 7


def _build_smartpal_index(db: Session) -> dict[str, SmartpalInvoiceEntry]:
    index: dict[str, SmartpalInvoiceEntry] = {}
    for entry in db.execute(select(SmartpalInvoiceEntry)).scalars():
        for raw in (entry.invoice_no, entry.vendor_invoice_no):
            if raw:
                index.setdefault(normalize_invoice_number(raw), entry)
    return index


def _build_pir_index(db: Session) -> dict[str, PirEntry]:
    index: dict[str, PirEntry] = {}
    for entry in db.execute(select(PirEntry)).scalars():
        for raw in (entry.invoice_no, entry.reg_invoice_no, entry.vendor_invoice_no):
            if raw:
                index.setdefault(normalize_invoice_number(raw), entry)
    return index


def _build_invoice_mail_index(db: Session) -> dict[str, InvoiceMailEntry]:
    index: dict[str, InvoiceMailEntry] = {}
    for entry in db.execute(select(InvoiceMailEntry)).scalars():
        index.setdefault(entry.invoice_number_normalized, entry)
    return index


def _build_vendor_domain_bridge(db: Session) -> dict[str, set[str]]:
    """Maps a sender domain to the normalized vendor name(s) confirmed to use that domain, via
    vendors.email and vendor_master_entries.email (the latter being SmartPAL's own fleet-wide
    vendor list — the more authoritative source, since its vendor_name spelling is what
    smartpal_invoice_entries/pir_entries themselves were scraped with). Used ONLY to establish
    "same vendor" for the fallback match below — see module docstring on why this is an
    email-domain lookup, never a name-similarity guess."""
    bridge: dict[str, set[str]] = {}

    def add(email: str | None, name: str | None) -> None:
        if not email or not name:
            return
        domain = extract_domain(email)
        if domain:
            bridge.setdefault(domain, set()).add(normalize_vendor_name(name))

    for email, name in db.execute(select(Vendor.email, Vendor.name)).all():
        add(email, name)
    for email, name in db.execute(select(VendorMasterEntry.email, VendorMasterEntry.vendor_name)).all():
        add(email, name)
    return bridge


_FallbackRow = tuple[Decimal, str | None, date | None, object]


def _build_smartpal_fallback_index(db: Session) -> dict[str, list[_FallbackRow]]:
    index: dict[str, list[_FallbackRow]] = {}
    rows = db.execute(
        select(SmartpalInvoiceEntry.vendor_name, SmartpalInvoiceEntry.amount,
               SmartpalInvoiceEntry.currency_code, SmartpalInvoiceEntry.invoice_date, SmartpalInvoiceEntry)
    ).all()
    for vendor_name, amount, currency, entry_date, entry in rows:
        if vendor_name and amount is not None:
            index.setdefault(normalize_vendor_name(vendor_name), []).append((amount, currency, entry_date, entry))
    return index


def _build_pir_fallback_index(db: Session) -> dict[str, list[_FallbackRow]]:
    # PIR has no invoice_date column — reg_date (when the record was registered in SmartPAL) is
    # the closest available anchor, hence the generous _FALLBACK_DATE_WINDOW_DAYS tolerance.
    index: dict[str, list[_FallbackRow]] = {}
    rows = db.execute(
        select(PirEntry.vendor_name, PirEntry.amount, PirEntry.currency_code, PirEntry.reg_date, PirEntry)
    ).all()
    for vendor_name, amount, currency, entry_date, entry in rows:
        if vendor_name and amount is not None:
            index.setdefault(normalize_vendor_name(vendor_name), []).append((amount, currency, entry_date, entry))
    return index


def _fallback_match(
    candidate_vendor_names: set[str],
    amount: Decimal | None,
    currency: str | None,
    invoice_date: date | None,
    index: dict[str, list[_FallbackRow]],
):
    """Returns the single entry matching amount exactly (+ currency when both sides have one) and
    within _FALLBACK_DATE_WINDOW_DAYS of invoice_date, across every candidate vendor name — or
    None if nothing qualifies, or more than one does (ambiguous, deliberately not guessed at)."""
    if amount is None or invoice_date is None:
        return None
    matches = []
    for name in candidate_vendor_names:
        for entry_amount, entry_currency, entry_date, entry in index.get(name, []):
            if entry_amount != amount:
                continue
            if currency and entry_currency and currency != entry_currency:
                continue
            if entry_date is None or abs((entry_date - invoice_date).days) > _FALLBACK_DATE_WINDOW_DAYS:
                continue
            matches.append(entry)
    return matches[0] if len(matches) == 1 else None


def rematch_all_current_line_items(db: Session) -> int:
    """Returns the number of line items (re)matched."""
    smartpal_index = _build_smartpal_index(db)
    pir_index = _build_pir_index(db)
    invoice_mail_index = _build_invoice_mail_index(db)

    vendor_bridge = _build_vendor_domain_bridge(db)
    smartpal_fallback_index = _build_smartpal_fallback_index(db)
    pir_fallback_index = _build_pir_fallback_index(db)

    rows = (
        db.execute(
            select(SoaLineItem, SoaDocument.canonical_domain)
            .join(SoaDocument, SoaLineItem.soa_document_id == SoaDocument.id)
            .where(SoaDocument.is_current.is_(True))
        )
        .all()
    )

    now = datetime.now(timezone.utc)
    for item, canonical_domain in rows:
        key = item.invoice_number_normalized

        if key in smartpal_index:
            entry = smartpal_index[key]
            item.match_source = "SMARTPAL"
            item.match_status_label = entry.status or "Unknown SmartPAL Status"
            item.matched_entry_id = entry.id
        elif key in pir_index:
            entry = pir_index[key]
            item.match_source = "PIR"
            item.match_status_label = "Needs Triage"
            item.matched_entry_id = entry.id
        elif key in invoice_mail_index:
            entry = invoice_mail_index[key]
            item.match_source = "INVOICE_MAIL"
            item.match_status_label = "Known Only From Invoice Mail"
            item.matched_entry_id = entry.id
        else:
            candidate_vendor_names = vendor_bridge.get(canonical_domain, set())
            compare_amount = item.amount if item.amount is not None else item.remaining_amount
            fallback_entry = _fallback_match(
                candidate_vendor_names, compare_amount, item.currency, item.invoice_date, smartpal_fallback_index
            )
            if fallback_entry:
                item.match_source = "SMARTPAL"
                item.match_status_label = f"{fallback_entry.status or 'Unknown SmartPAL Status'} (amount/date match)"
                item.matched_entry_id = fallback_entry.id
            else:
                fallback_entry = _fallback_match(
                    candidate_vendor_names, compare_amount, item.currency, item.invoice_date, pir_fallback_index
                )
                if fallback_entry:
                    item.match_source = "PIR"
                    item.match_status_label = "Needs Triage (amount/date match)"
                    item.matched_entry_id = fallback_entry.id
                else:
                    item.match_source = "NONE"
                    item.match_status_label = None
                    item.matched_entry_id = None

        item.matched_at = now

    db.commit()
    log.info("Rematched %d current SOA line item(s)", len(rows))
    return len(rows)
