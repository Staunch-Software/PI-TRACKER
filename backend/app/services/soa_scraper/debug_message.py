# ===========================================================================
# One-off diagnostic: re-fetches a specific already-ingested SOA message (looked up by a
# substring matched against subject OR sender_email OR vendor_name_raw) directly via Graph,
# bypassing ingest.py's dedupe, and dumps attachment names/types plus per-attachment
# table-extraction results. Not part of the regular pipeline — run manually when a vendor's SOA
# comes back with zero extracted tables and the deployed log output doesn't say why.
#
# Usage (from backend/, with the venv active or via venv/bin/python):
#   python -m app.services.soa_scraper.debug_message "<subject, sender email, or vendor name substring>"
# ===========================================================================
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.soa_document import SoaDocument
from app.models.vessel import Vessel
from app.services.soa_scraper.line_item_extractor import extract_line_items
from app.services.soa_scraper.ms_graph_client import MsGraphClient
from app.services.soa_scraper.table_extraction import html_tables, pdf_tables, xlsx_tables


def _print_table_preview(table, max_rows: int = 40) -> None:
    print(f"      source={table.source!r} rows={len(table.rows)} context_text={table.context_text[:80]!r}")
    for i, row in enumerate(table.rows[:max_rows]):
        # Only show non-blank cells with their column index, so a mostly-empty wide row (common
        # in these vendor exports — see line_item_extractor.py's header-window docstring) stays
        # readable instead of a wall of ''.
        non_blank = [(idx, cell) for idx, cell in enumerate(row) if cell.strip()] if isinstance(row, list) else []
        print(f"        row {i}: {non_blank}")


def main(search: str) -> None:
    db = SessionLocal()
    try:
        # Several different vendors' emails share near-identical subjects (e.g. "RE: Ozellar
        # Marine - Invoices Overdue" — confirmed live across at least 3 senders), so match on
        # sender email / vendor name too, not just subject.
        like = f"%{search}%"
        doc = db.execute(
            select(SoaDocument)
            .where(
                SoaDocument.subject.ilike(like)
                | SoaDocument.sender_email.ilike(like)
                | SoaDocument.vendor_name_raw.ilike(like)
            )
            .order_by(SoaDocument.ingested_at.desc())
        ).scalars().first()
        if not doc:
            print(f"No soa_documents row matching {search!r} (subject/sender_email/vendor_name_raw)")
            return

        print(f"Found: mailbox={doc.mailbox} graph_message_id={doc.graph_message_id} subject={doc.subject!r}")
        print(f"Stored raw_tables_json has {len(doc.raw_tables_json)} table(s) from the original ingestion run.")

        client = MsGraphClient()
        raw = {
            "id": doc.graph_message_id,
            "internetMessageId": doc.internet_message_id,
            "subject": doc.subject,
            "receivedDateTime": doc.received_at.isoformat(),
            "from": {"emailAddress": {"address": doc.sender_email, "name": doc.sender_name}},
            "hasAttachments": doc.has_attachment,
        }
        message = client.get_message(doc.mailbox, raw, with_attachments=True)

        # NOTE: body_html will be empty here — get_message() reads it out of the raw dict Graph's
        # list endpoint normally supplies (see ms_graph_client.list_recent_messages' $select),
        # which this stub raw dict doesn't have. Only attachment parsing is meaningfully
        # re-testable through this script; body-table parsing isn't.
        print(f"\nbody_html length: {len(message.body_html)} chars (expected 0 — see note above)")
        all_tables = html_tables(message.body_html)

        print(f"\nattachments: {len(message.attachments)}")
        for att in message.attachments:
            name = att["name"]
            content_type = att["content_type"]
            size = len(att["bytes"])
            print(f"  - {name!r} ({content_type}, {size} bytes)")

            lower = name.lower()
            if lower.endswith(".pdf") or content_type == "application/pdf":
                tables = pdf_tables(att["bytes"])
                print(f"      pdf_tables() found: {len(tables)}")
                for t in tables:
                    _print_table_preview(t)
                if not tables:
                    import pdfplumber
                    import io
                    with pdfplumber.open(io.BytesIO(att["bytes"])) as pdf:
                        for i, page in enumerate(pdf.pages, 1):
                            text = page.extract_text() or ""
                            print(f"      page {i}: extract_text() length={len(text)}, first 200 chars: {text[:200]!r}")
                all_tables.extend(tables)
            elif lower.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in content_type:
                tables = xlsx_tables(att["bytes"])
                print(f"      xlsx_tables() found: {len(tables)}")
                for t in tables:
                    _print_table_preview(t)
                all_tables.extend(tables)
            elif lower.endswith(".xls"):
                print("      .xls (old binary Excel format) — NOT handled by openpyxl/xlsx_tables")
            else:
                print(f"      unrecognized attachment type for table extraction: {name} ({content_type})")

        vessel_names = [row[0] for row in db.execute(select(Vessel.name)).all()]
        items = extract_line_items(all_tables, vessel_names)
        print(f"\nextract_line_items() would produce {len(items)} item(s) right now:")
        for item in items:
            print(f"  {item}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m app.services.soa_scraper.debug_message \"<subject substring>\"")
        sys.exit(1)
    main(sys.argv[1])
