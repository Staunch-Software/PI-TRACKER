# ===========================================================================
# backend/app/services/soa_scraper/table_extraction.py
#
# Pulls STRUCTURED tables (not flattened text) out of an SOA/invoice email's body + attachments,
# for the deterministic header-keyword extraction in line_item_extractor.py. Replaces the old
# "flatten everything into one text blob for an LLM prompt" approach (document_text.py's
# build_document_text/pdf_bytes_to_text/xlsx_bytes_to_text/attachment_to_text, all removed) — see
# line_item_extractor.py module docstring for why.
#
# Every vendor's SOA line items live in some kind of table: an inline HTML <table> in the email
# body (Shell, Navarino/ABS — confirmed live), a PDF attachment, or an Excel attachment (Den-Jet —
# confirmed live). Each Table below carries its own rows PLUS "context_text" — nearby non-table
# text (the preceding HTML between tables, the worksheet title, the PDF page's non-table text) —
# since some vendor formats name the vessel in free text next to/above the table rather than in a
# column of their own (Den-Jet: 'To Master/Owners of Vessel "GCL NARMADA"').
# ===========================================================================
import io
import logging
from dataclasses import dataclass, field

import openpyxl
import pdfplumber
from bs4 import BeautifulSoup, Tag

log = logging.getLogger(__name__)


@dataclass
class Table:
    rows: list[list[str]]
    context_text: str = ""
    source: str = ""  # human-readable origin, for logging only (e.g. "email body", "Sheet1")


def _cell_text(cell) -> str:
    return " ".join(cell.get_text(separator=" ", strip=True).split()) if hasattr(cell, "get_text") else str(cell or "").strip()


def html_tables(html: str) -> list[Table]:
    """One Table per <table> element in the email body. context_text is the plain text between
    the previous table (or the start of the document) and this one — covers vendor formats that
    put a vessel-naming heading directly above each per-vessel table."""
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    html_table_tags = soup.find_all("table")
    if not html_table_tags:
        return []

    tables: list[Table] = []
    for i, tag in enumerate(html_table_tags):
        # Text between the end of the previous table and the start of this one (or from the
        # document start for the first table) — covers vendor formats that put a vessel-naming
        # heading directly above each per-vessel table.
        context_text = _preceding_text(tag)

        rows = []
        for tr in tag.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if cells:
                rows.append([_cell_text(c) for c in cells])
        if rows:
            tables.append(Table(rows=rows, context_text=context_text, source=f"email body table #{i + 1}"))

    return tables


def _preceding_text(table_tag: Tag) -> str:
    """Plain text of everything between the previous <table> (exclusive) and this one
    (exclusive), or from the top of the document if this is the first table."""
    parts: list[str] = []
    node = table_tag.previous_element
    while node is not None:
        if isinstance(node, Tag) and node.name == "table":
            break
        if isinstance(node, str):
            text = node.strip()
            if text:
                parts.append(text)
        node = node.previous_element
    parts.reverse()
    return " ".join(parts)


def xlsx_tables(data: bytes) -> list[Table]:
    tables: list[Table] = []
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        for ws in wb.worksheets:
            rows = []
            for row in ws.iter_rows(values_only=True):
                if all(v is None or str(v).strip() == "" for v in row):
                    continue
                rows.append(["" if v is None else str(v).strip() for v in row])
            if rows:
                tables.append(Table(rows=rows, context_text=ws.title, source=f"sheet {ws.title!r}"))
    except Exception:
        log.exception("Failed to extract tables from Excel attachment")
    return tables


def pdf_tables(data: bytes) -> list[Table]:
    tables: list[Table] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page_no, page in enumerate(pdf.pages, start=1):
                page_text = page.extract_text() or ""
                for raw_table in page.extract_tables():
                    rows = [[(_strip(cell)) for cell in row] for row in raw_table]
                    rows = [r for r in rows if any(c for c in r)]
                    if rows:
                        tables.append(Table(rows=rows, context_text=page_text, source=f"PDF page {page_no}"))
    except Exception:
        log.exception("Failed to extract tables from PDF attachment")
    return tables


def _strip(cell) -> str:
    return (cell or "").strip() if isinstance(cell, str) else ("" if cell is None else str(cell).strip())


def extract_all_tables(body_html: str, attachments: list[dict]) -> list[Table]:
    """Combines every table found in the email body and its extractable attachments. Same
    attachment type dispatch as the old attachment_to_text (PDF, .xlsx/.xlsm) — anything else is
    skipped (logged) since we have no structured reader for it."""
    tables = html_tables(body_html)
    for att in attachments:
        name = att["name"].lower()
        content_type = att["content_type"]
        if name.endswith(".pdf") or content_type == "application/pdf":
            tables.extend(pdf_tables(att["bytes"]))
        elif name.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in content_type:
            tables.extend(xlsx_tables(att["bytes"]))
        else:
            log.info("Skipping attachment %s (%s) — unsupported type for table extraction", att["name"], content_type)
    return tables
