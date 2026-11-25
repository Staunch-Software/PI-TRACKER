# ===========================================================================
# One-off diagnostic: re-fetches a specific already-ingested SOA message (looked up by a subject
# substring) directly via Graph, bypassing ingest.py's dedupe, and dumps attachment names/types
# plus per-attachment table-extraction results. Not part of the regular pipeline — run manually
# when a vendor's SOA comes back with zero extracted tables and the deployed log output doesn't
# say why.
#
# Usage (from backend/, with the venv active or via venv/bin/python):
#   python -m app.services.soa_scraper.debug_message "<subject substring>"
# ===========================================================================
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.soa_document import SoaDocument
from app.services.soa_scraper.ms_graph_client import MsGraphClient
from app.services.soa_scraper.table_extraction import html_tables, pdf_tables, xlsx_tables


def main(subject_substring: str) -> None:
    db = SessionLocal()
    try:
        doc = db.execute(
            select(SoaDocument)
            .where(SoaDocument.subject.ilike(f"%{subject_substring}%"))
            .order_by(SoaDocument.ingested_at.desc())
        ).scalars().first()
        if not doc:
            print(f"No soa_documents row matching subject {subject_substring!r}")
            return

        print(f"Found: mailbox={doc.mailbox} graph_message_id={doc.graph_message_id} subject={doc.subject!r}")

        client = MsGraphClient()
        raw = {"id": doc.graph_message_id, "hasAttachments": doc.has_attachment}
        message = client.get_message(doc.mailbox, raw, with_attachments=True)

        print(f"\nbody_html length: {len(message.body_html)} chars")
        body_tables = html_tables(message.body_html)
        print(f"html_tables() found: {len(body_tables)}")

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
                if not tables:
                    import pdfplumber
                    import io
                    with pdfplumber.open(io.BytesIO(att["bytes"])) as pdf:
                        for i, page in enumerate(pdf.pages, 1):
                            text = page.extract_text() or ""
                            print(f"      page {i}: extract_text() length={len(text)}, first 200 chars: {text[:200]!r}")
            elif lower.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in content_type:
                tables = xlsx_tables(att["bytes"])
                print(f"      xlsx_tables() found: {len(tables)}")
            elif lower.endswith(".xls"):
                print("      .xls (old binary Excel format) — NOT handled by openpyxl/xlsx_tables")
            else:
                print(f"      unrecognized attachment type for table extraction: {name} ({content_type})")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m app.services.soa_scraper.debug_message \"<subject substring>\"")
        sys.exit(1)
    main(sys.argv[1])
