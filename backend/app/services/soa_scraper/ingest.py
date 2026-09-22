# ===========================================================================
# backend/app/services/soa_scraper/ingest.py
#
# Main SOA/invoice-mail ingestion pipeline: poll the configured mailboxes via Microsoft Graph
# (ms_graph_client.py), extract structured line items via Ollama (ollama_extractor.py), and
# persist. Run as a standalone script for now (see __main__) — not yet wired to a schedule or
# API endpoint; that comes once ingestion is verified against real mail.
#
# Versioning: when a new SOA arrives from a vendor (identified by sender_domain — see
# soa_document.py docstring) that already has a current SOA, the previous one is soft-deleted
# (is_current = False) rather than replaced/deleted, before the new one is inserted as current.
# ===========================================================================
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.invoice_mail_entry import InvoiceMailEntry
from app.models.soa_document import SoaDocument
from app.models.soa_line_item import SoaLineItem
from app.models.soa_vendor_domain_alias import SoaVendorDomainAlias
from app.models.vessel import Vessel
from app.services.pir_vessel_matcher import normalize_vessel_name
from app.services.soa_scraper.document_text import build_document_text, extract_original_external_sender
from app.services.soa_scraper.ms_graph_client import GraphMessage, MsGraphClient
from app.services.soa_scraper.normalize import extract_domain, normalize_invoice_number, parse_iso_date
from app.services.soa_scraper.ollama_extractor import extract_line_items
from app.services.soa_scraper.subject_filter import looks_like_invoice_subject, looks_like_soa_subject

log = logging.getLogger(__name__)


def _resolve_vessel_id(db: Session, vessel_name: str | None, vessel_cache: dict[str, str]) -> str | None:
    if not vessel_name:
        return None
    normalized = normalize_vessel_name(vessel_name)
    return vessel_cache.get(normalized)


def _load_vessel_cache(db: Session) -> dict[str, str]:
    rows = db.execute(select(Vessel.id, Vessel.name)).all()
    return {normalize_vessel_name(name): str(vessel_id) for vessel_id, name in rows}


def _load_domain_alias_cache(db: Session) -> dict[str, str]:
    rows = db.execute(select(SoaVendorDomainAlias.alias_domain, SoaVendorDomainAlias.canonical_domain)).all()
    return dict(rows)


def _resolve_canonical_domain(sender_domain: str, alias_cache: dict[str, str]) -> str:
    """See SoaVendorDomainAlias / SoaDocument.canonical_domain docstrings — resolves a raw sender
    domain to the vendor identity actually used for supersession, defaulting to itself when no
    alias is on file."""
    return alias_cache.get(sender_domain, sender_domain)


def ingest_soa_mailbox(
    db: Session,
    client: MsGraphClient,
    mailbox: str,
    vessel_cache: dict[str, str],
    alias_cache: dict[str, str],
    top: int = 25,
) -> int:
    """Returns count of newly-ingested SOA documents."""
    raw_messages = client.list_recent_messages(mailbox, top=top)
    existing_ids = {
        row[0]
        for row in db.execute(
            select(SoaDocument.graph_message_id).where(
                SoaDocument.graph_message_id.in_([m["id"] for m in raw_messages])
            )
        ).all()
    }
    # Cross-mailbox dedupe key (see SoaDocument.internet_message_id docstring) — checked against
    # the actual Message-ID, not the per-mailbox graph_message_id, so a CC'd SOA email already
    # extracted via one of the other 3 SOA mailboxes is skipped here BEFORE running extraction
    # again. Grown as new documents are created below so duplicates within this same batch/run
    # (not just ones already committed from a prior run) are also caught.
    seen_internet_ids = {
        row[0]
        for row in db.execute(
            select(SoaDocument.internet_message_id).where(
                SoaDocument.internet_message_id.in_(
                    [m["internetMessageId"] for m in raw_messages if m.get("internetMessageId")]
                )
            )
        ).all()
    }

    new_count = 0
    for raw in raw_messages:
        if raw["id"] in existing_ids:
            continue

        subject = raw.get("subject") or ""
        if not looks_like_soa_subject(subject):
            log.debug("Skipping message %s — subject doesn't look like an SOA: %r", raw["id"], subject)
            continue

        internet_message_id = raw.get("internetMessageId") or raw["id"]
        if internet_message_id in seen_internet_ids:
            log.info(
                "Skipping message %s — same email already ingested via another mailbox (internetMessageId=%s)",
                raw["id"], internet_message_id,
            )
            continue

        message: GraphMessage = client.get_message(mailbox, raw)
        sender_domain = extract_domain(message.sender_email)
        if not sender_domain:
            log.warning("Skipping message %s — no sender email/domain", message.id)
            continue

        vendor_email, vendor_name, vendor_domain = message.sender_email, message.sender_name, sender_domain
        if sender_domain in settings.internal_email_domains:
            # An internal Ozellar staff member replying/forwarding an existing vendor thread,
            # not the vendor themselves — see extract_original_external_sender docstring.
            original = extract_original_external_sender(message.body_html, settings.internal_email_domains)
            if original:
                vendor_name, vendor_email = original
                vendor_domain = extract_domain(vendor_email)
                log.info(
                    "Internal sender %s on message %s — using quoted original sender %s <%s> as vendor identity",
                    message.sender_email, message.id, vendor_name, vendor_email,
                )
            else:
                log.warning(
                    "Internal sender %s on message %s and no quoted external 'From:' found — "
                    "keeping internal sender as vendor identity (likely wrong, needs manual review)",
                    message.sender_email, message.id,
                )
        canonical_domain = _resolve_canonical_domain(vendor_domain, alias_cache)

        document_text = build_document_text(message.body_html, message.attachments)
        try:
            items = extract_line_items(
                document_text,
                sender_name=vendor_name or vendor_domain,
                sender_domain=vendor_domain,
                document_kind="Statement of Account (SOA)",
            )
        except Exception:
            log.exception("Extraction failed for message %s from %s — skipping", message.id, message.sender_email)
            continue

        if not items:
            log.info("No line items extracted from %s (%s) — not creating a document", message.id, message.subject)
            continue

        # Soft-delete the vendor's previous current SOA, keyed on canonical_domain — not raw
        # sender_domain — so an aliased vendor (see SoaVendorDomainAlias docstring) correctly
        # supersedes across its different sending domains instead of appearing as two vendors.
        db.execute(
            SoaDocument.__table__.update()
            .where(SoaDocument.canonical_domain == canonical_domain, SoaDocument.is_current.is_(True))
            .values(is_current=False)
        )

        doc = SoaDocument(
            graph_message_id=message.id,
            internet_message_id=message.internet_message_id,
            mailbox=mailbox,
            sender_email=message.sender_email,
            sender_name=message.sender_name,
            sender_domain=sender_domain,
            canonical_domain=canonical_domain,
            vendor_name_raw=vendor_name,
            subject=message.subject,
            received_at=message.received_at,
            is_current=True,
            has_attachment=message.has_attachments,
        )
        db.add(doc)
        db.flush()  # populate doc.id for the line items below
        seen_internet_ids.add(internet_message_id)

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
                    },
                )
            )

        db.commit()
        new_count += 1
        log.info("Ingested SOA from %s (%s): %d line item(s)", message.sender_email, message.subject, len(items))

    return new_count


def ingest_invoice_mailbox(db: Session, client: MsGraphClient, mailbox: str, vessel_cache: dict[str, str], top: int = 25) -> int:
    raw_messages = client.list_recent_messages(mailbox, top=top)
    existing_ids = {
        row[0]
        for row in db.execute(
            select(InvoiceMailEntry.graph_message_id).where(
                InvoiceMailEntry.graph_message_id.in_([m["id"] for m in raw_messages])
            )
        ).all()
    }

    new_count = 0
    for raw in raw_messages:
        if raw["id"] in existing_ids:
            continue

        subject = raw.get("subject") or ""
        if not looks_like_invoice_subject(subject):
            log.debug("Skipping message %s — subject doesn't look like an invoice: %r", raw["id"], subject)
            continue

        message: GraphMessage = client.get_message(mailbox, raw)
        sender_domain = extract_domain(message.sender_email)

        document_text = build_document_text(message.body_html, message.attachments)
        try:
            items = extract_line_items(
                document_text,
                sender_name=message.sender_name or sender_domain,
                sender_domain=sender_domain,
                document_kind="invoice email",
            )
        except Exception:
            log.exception("Extraction failed for invoice message %s from %s — skipping", message.id, message.sender_email)
            continue

        for item in items:
            vessel_id = _resolve_vessel_id(db, item.vessel_name, vessel_cache)
            db.add(
                InvoiceMailEntry(
                    graph_message_id=message.id,
                    sender_email=message.sender_email,
                    subject=message.subject,
                    received_at=message.received_at,
                    invoice_number=item.invoice_number,
                    invoice_number_normalized=normalize_invoice_number(item.invoice_number),
                    invoice_date=parse_iso_date(item.invoice_date),
                    amount=item.amount,
                    currency=item.currency,
                    vendor_name_raw=message.sender_name,
                    vessel_name_raw=item.vessel_name,
                    vessel_id=vessel_id,
                    raw_json={
                        "invoice_number": item.invoice_number,
                        "invoice_date": item.invoice_date,
                        "amount": item.amount,
                        "currency": item.currency,
                        "vessel_name": item.vessel_name,
                    },
                )
            )

        if items:
            db.commit()
            new_count += 1
            log.info("Ingested invoice mail from %s (%s): %d line item(s)", message.sender_email, message.subject, len(items))

    return new_count


def run_ingestion() -> None:
    client = MsGraphClient()
    db = SessionLocal()
    try:
        vessel_cache = _load_vessel_cache(db)
        alias_cache = _load_domain_alias_cache(db)

        for mailbox in settings.soa_mailboxes:
            log.info("Polling SOA mailbox: %s", mailbox)
            try:
                ingest_soa_mailbox(db, client, mailbox, vessel_cache, alias_cache)
            except Exception:
                log.exception("Failed polling SOA mailbox %s", mailbox)

        log.info("Polling invoice mailbox: %s", settings.invoice_mailbox)
        try:
            ingest_invoice_mailbox(db, client, settings.invoice_mailbox, vessel_cache)
        except Exception:
            log.exception("Failed polling invoice mailbox %s", settings.invoice_mailbox)

        from app.services.soa_scraper.matching import rematch_all_current_line_items

        log.info("Running SOA match pass...")
        rematch_all_current_line_items(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run_ingestion()
