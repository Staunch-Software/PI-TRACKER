# ===========================================================================
# backend/app/services/soa_scraper/reprocess.py
#
# Re-extracts already-ingested SOA documents whose line items could improve from here on: a
# document stored as a single "UNPARSED-..." placeholder (nothing was recognized at ingestion
# time) or one whose extraction came back wrong, where a code fix SINCE THEN might now find real
# (or correct) line items — by re-running extract_line_items against the RAW TABLES ALREADY
# PERSISTED at ingestion time (doc.raw_tables_json), not by re-fetching the message. This is the
# whole point of persisting raw_tables_json in the first place (see SoaDocument docstring): a
# document whose real content lived entirely in the email body (no attachments) can be
# reprocessed here exactly like one from an attachment, since we never need the live body again.
#
# Does NOT re-poll a mailbox, re-fetch via Graph, or touch ingest.py's dedupe state — it only
# reads/rewrites rows already in the DB, so this is safe to run repeatedly after any
# extraction-logic change without risk of re-ingesting duplicates, affecting what a normal ingest
# run considers "new", or depending on mailbox/network access at all.
#
# Usage (from backend/):
#   python -m app.services.soa_scraper.reprocess
#       Every is_current document that LOOKS broken (empty raw_tables_json / an UNPARSED
#       placeholder) — safe to run unattended.
#   python -m app.services.soa_scraper.reprocess "<subject, sender email, or vendor name substring>"
#       FORCE-reprocesses every is_current document matching that search, regardless of its
#       current state — use this for a document with real-looking but WRONG line items (a
#       header-keyword fix that changes what an already-non-empty extraction produces), which the
#       no-argument form's auto-detect can't tell apart from a correct one.
#
# A document with genuinely empty raw_tables_json (nothing was ever extracted, e.g. no tables
# existed at all in the original message) stays unparseable here, same as before — there is no
# "re-fetch from mail" fallback by design; see module history for why that path was removed (its
# own body_html blind spot made it unable to reprocess body-only documents at all).
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
from app.services.soa_scraper.normalize import normalize_invoice_number, parse_iso_date
from app.services.soa_scraper.table_extraction import Table

log = logging.getLogger(__name__)


def _line_items_for(db: Session, doc_id) -> list[SoaLineItem]:
    return list(db.execute(select(SoaLineItem).where(SoaLineItem.soa_document_id == doc_id)).scalars())


def _find_candidates(db: Session, search: str | None) -> list[SoaDocument]:
    """With no search term: every is_current document that LOOKS broken (empty raw_tables_json or
    an UNPARSED placeholder) — safe to run unattended after any extraction-logic change. With a
    search term (matched against subject/sender_email/vendor_name_raw): force-reprocesses that
    document regardless of its current state, since a document can have real-looking, non-empty,
    non-"unparsed" line items that are still WRONG (confirmed live: a header-keyword collision
    silently mapped a PO reference into invoice_number instead of the real invoice number — see
    line_item_extractor.py's Transaction#/Reference# fix) — the auto-detect heuristic has no way
    to tell that apart from a correct extraction, so an operator targeting a known-bad document by
    name is trusted over it."""
    query = select(SoaDocument).where(SoaDocument.is_current)
    if search:
        like = f"%{search}%"
        return list(
            db.execute(
                query.where(
                    SoaDocument.subject.ilike(like)
                    | SoaDocument.sender_email.ilike(like)
                    | SoaDocument.vendor_name_raw.ilike(like)
                )
            ).scalars()
        )

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


def reprocess_document(db: Session, doc: SoaDocument, vessel_cache: dict[str, str]) -> bool:
    """Returns True if this document's line items changed (placeholder/wrong replaced with real
    extracted items). Re-extracts from the ALREADY-PERSISTED raw_tables_json (set at ingestion
    time, or by a previous reprocess run) rather than re-fetching the message — see module
    docstring. A document whose raw_tables_json is empty has nothing to re-extract from and stays
    unparseable."""
    tables = [Table(rows=t["rows"], context_text=t.get("context_text", ""), source=t.get("source", ""))
              for t in doc.raw_tables_json]
    items = extract_line_items(tables, list(vessel_cache.keys()))

    if not items:
        return False

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

        improved = 0
        for doc in candidates:
            print(f"- {doc.vendor_name_raw!r} / {doc.subject!r} ...", end=" ")
            try:
                changed = reprocess_document(db, doc, vessel_cache)
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
                print("still unparseable")

        print(f"\n{improved}/{len(candidates)} document(s) improved.")
        print("Running match pass...")
        rematch_all_current_line_items(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    main(sys.argv[1] if len(sys.argv) > 1 else None)
