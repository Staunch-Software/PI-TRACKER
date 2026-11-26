# ===========================================================================
# backend/app/services/soa_scraper/reprocess.py
#
# Re-extracts already-ingested SOA documents whose line items could improve from here on: a
# document stored as a single "UNPARSED-..." placeholder (nothing was recognized at ingestion
# time) or one whose raw_tables_json came back empty, where a code fix SINCE THEN might now find
# real line items (the whole point of persisting raw_tables_json — see SoaDocument docstring).
#
# Does NOT re-poll a mailbox's message list or touch ingest.py's dedupe state (graph_message_id/
# internet_message_id) — it re-fetches each target message directly by its already-stored
# graph_message_id/mailbox, so this is safe to run repeatedly after any extraction-logic change
# without risk of re-ingesting duplicates or affecting what a normal ingest run considers "new".
#
# Usage (from backend/):
#   python -m app.services.soa_scraper.reprocess                      # every current candidate
#   python -m app.services.soa_scraper.reprocess "<subject substring>"  # just one
# ===========================================================================
import logging
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.soa_document import SoaDocument
from app.models.soa_line_item import SoaLineItem
from app.models.vessel import Vessel
from app.services.pir_vessel_matcher import normalize_vessel_name
from app.services.soa_scraper.line_item_extractor import extract_line_items
from app.services.soa_scraper.matching import rematch_all_current_line_items
from app.services.soa_scraper.ms_graph_client import MsGraphClient
from app.services.soa_scraper.normalize import normalize_invoice_number, parse_iso_date
from app.services.soa_scraper.table_extraction import extract_all_tables

log = logging.getLogger(__name__)


def _line_items_for(db: Session, doc_id) -> list[SoaLineItem]:
    return list(db.execute(select(SoaLineItem).where(SoaLineItem.soa_document_id == doc_id)).scalars())


def _find_candidates(db: Session, subject_substring: str | None) -> list[SoaDocument]:
    query = select(SoaDocument).where(SoaDocument.is_current)
    if subject_substring:
        query = query.where(SoaDocument.subject.ilike(f"%{subject_substring}%"))
    docs = db.execute(query).scalars().all()
    return [
        doc for doc in docs
        if len(doc.raw_tables_json) == 0
        or any((li.raw_json or {}).get("unparsed") for li in _line_items_for(db, doc.id))
    ]


def _resolve_vessel_id(db: Session, vessel_name: str | None, vessel_cache: dict[str, str]) -> str | None:
    if not vessel_name:
        return None
    return vessel_cache.get(normalize_vessel_name(vessel_name))


def reprocess_document(db: Session, client: MsGraphClient, doc: SoaDocument, vessel_cache: dict[str, str]) -> bool:
    """Returns True if this document's line items changed (placeholder/empty replaced with real
    extracted items)."""
    raw = {
        "id": doc.graph_message_id,
        "internetMessageId": doc.internet_message_id,
        "subject": doc.subject,
        "receivedDateTime": doc.received_at.isoformat(),
        "from": {"emailAddress": {"address": doc.sender_email, "name": doc.sender_name}},
        "hasAttachments": doc.has_attachment,
    }
    message = client.get_message(doc.mailbox, raw, with_attachments=True)

    # NOTE: message.body_html will always be empty here — see debug_message.py's note on the same
    # limitation. Only attachment-sourced tables are meaningfully reprocessable through this path.
    tables = extract_all_tables("", message.attachments)
    items = extract_line_items(tables, list(vessel_cache.keys()))

    if not items:
        # Don't overwrite raw_tables_json with this script's own blind spot: a document with NO
        # attachments (has_attachment=False) had all its real content in the body, which
        # ingest.py's original run could see (and may have already extracted real line items
        # from) but this script cannot. Recording "0 tables" here would erase an honest
        # ingestion-time value with a false negative caused purely by this script's limitation,
        # not a real re-check. Only record a negative result when there WERE attachments to
        # actually re-examine.
        if message.attachments:
            doc.raw_tables_json = [
                {"rows": t.rows, "context_text": t.context_text, "source": t.source} for t in tables
            ]
        return False

    doc.raw_tables_json = [
        {"rows": t.rows, "context_text": t.context_text, "source": t.source} for t in tables
    ]

    for li in _line_items_for(db, doc.id):
        db.delete(li)
    db.flush()

    for item in items:
        vessel_id = _resolve_vessel_id(db, item.vessel_name, vessel_cache)
        db.add(
            SoaLineItem(
                soa_document_id=doc.id,
                invoice_number=item.invoice_number,
                invoice_number_normalized=normalize_invoice_number(item.invoice_number),
                invoice_date=parse_iso_date(item.invoice_date),
                amount=item.amount,
                remaining_amount=item.remaining_amount,
                currency=item.currency,
                vessel_name_raw=item.vessel_name,
                vessel_id=vessel_id,
                raw_json={
                    "invoice_number": item.invoice_number,
                    "invoice_date": item.invoice_date,
                    "amount": item.amount,
                    "remaining_amount": item.remaining_amount,
                    "currency": item.currency,
                    "vessel_name": item.vessel_name,
                    "unparsed": False,
                },
            )
        )
    return True


def main(subject_substring: str | None) -> None:
    db = SessionLocal()
    try:
        vessel_cache = {
            normalize_vessel_name(name): str(vessel_id)
            for vessel_id, name in db.execute(select(Vessel.id, Vessel.name)).all()
        }
        candidates = _find_candidates(db, subject_substring)
        print(f"{len(candidates)} candidate document(s) to reprocess.")

        client = MsGraphClient()
        improved = 0
        for doc in candidates:
            print(f"- {doc.vendor_name_raw!r} / {doc.subject!r} ...", end=" ")
            try:
                changed = reprocess_document(db, client, doc, vessel_cache)
            except Exception:
                log.exception("Failed to reprocess document %s", doc.id)
                db.rollback()
                print("ERROR (see log)")
                continue
            db.commit()
            if changed:
                improved += 1
                print(f"now {len(_line_items_for(db, doc.id))} real line item(s)")
            else:
                print("still unparseable (raw_tables_json updated for future debugging)")

        print(f"\n{improved}/{len(candidates)} document(s) improved.")
        print("Running match pass...")
        rematch_all_current_line_items(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    main(sys.argv[1] if len(sys.argv) > 1 else None)
