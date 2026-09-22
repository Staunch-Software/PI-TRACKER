# ===========================================================================
# backend/app/services/soa_scraper/matching.py
#
# Answers, for every CURRENT SOA line item, "where does this invoice live right now, and in
# what state" — checked in priority order (see SoaLineItem model docstring):
#   1. smartpal_invoice_entries (ALL statuses, not just Finally Approved — see that model's
#      docstring; this table is populated by a scraper extension not yet built, so until that
#      lands this source will simply have nothing to match against)
#   2. pir_entries
#   3. invoice_mail_entries
#   4. none of the above -> NONE ("No Match", needs triage)
#
# Match key is invoice_number_normalized (see normalize.py) — built as in-memory dicts here
# rather than a SQL join, since PIR's invoice number can live in any of 3 columns
# (invoice_no/reg_invoice_no/vendor_invoice_no) with no stored normalized form to join on, and
# the realistic row counts (thousands, per pir_entries.py's own docstring) make one Python pass
# far simpler than a correct multi-column fuzzy SQL join.
#
# Re-run via the /api/soa-entries/rematch endpoint (or automatically at the end of an ingestion
# run — see ingest.py) rather than only at ingestion time, since a line item's SmartPAL/PIR state
# can change without any new SOA arriving.
# ===========================================================================
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.invoice_mail_entry import InvoiceMailEntry
from app.models.pir_entry import PirEntry
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.models.soa_document import SoaDocument
from app.models.soa_line_item import SoaLineItem
from app.services.soa_scraper.normalize import normalize_invoice_number

log = logging.getLogger(__name__)


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


def rematch_all_current_line_items(db: Session) -> int:
    """Returns the number of line items (re)matched."""
    smartpal_index = _build_smartpal_index(db)
    pir_index = _build_pir_index(db)
    invoice_mail_index = _build_invoice_mail_index(db)

    line_items = (
        db.execute(
            select(SoaLineItem)
            .join(SoaDocument, SoaLineItem.soa_document_id == SoaDocument.id)
            .where(SoaDocument.is_current.is_(True))
        )
        .scalars()
        .all()
    )

    now = datetime.now(timezone.utc)
    for item in line_items:
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
            item.match_source = "NONE"
            item.match_status_label = None
            item.matched_entry_id = None

        item.matched_at = now

    db.commit()
    log.info("Rematched %d current SOA line item(s)", len(line_items))
    return len(line_items)
