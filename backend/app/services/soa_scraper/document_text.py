# ===========================================================================
# backend/app/services/soa_scraper/document_text.py
#
# Converts an email body + its attachments into one plain-text blob for the Ollama extraction
# prompt (ollama_extractor.py). Deliberately dumb/lossless rather than trying to parse structure
# here — every vendor's SOA layout is different (see soa_line_item.py docstring), so the LLM step
# is what handles structure; this module's only job is "get the words and numbers out" regardless
# of source format (inline HTML table in the body, PDF attachment, Excel attachment).
# ===========================================================================
import io
import logging
import re

import openpyxl
import pdfplumber
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

# Matches Outlook's embedded quoted-header line "From: Name <email@domain>" (also appears as
# "From: Name <email@domain> On Behalf Of ..." — confirmed live in real ABS/Shell samples) that
# gets baked into the HTML body on every reply/forward. Deliberately regex, not LLM-guessed — see
# extract_original_external_sender's docstring for why.
_QUOTED_FROM_RE = re.compile(r"From:\s*[|\s]*([^<\n|]+?)\s*<([^<>\s]+@[^<>\s]+)>", re.IGNORECASE)


def html_body_to_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # Tables carry the actual SOA line items in inline-HTML-table vendors (Shell, Navarino/ABS
    # confirmed live) — get_text with a separator keeps cells distinguishable instead of the
    # whole row collapsing into one run-on string.
    return soup.get_text(separator=" | ", strip=True)


def pdf_bytes_to_text(data: bytes) -> str:
    parts: list[str] = []
    try:
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                if text:
                    parts.append(text)
                for table in page.extract_tables():
                    for row in table:
                        parts.append(" | ".join(cell or "" for cell in row))
    except Exception:
        log.exception("Failed to extract text from PDF attachment")
    return "\n".join(parts)


def xlsx_bytes_to_text(data: bytes, max_rows_per_sheet: int = 500) -> str:
    parts: list[str] = []
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        for ws in wb.worksheets:
            parts.append(f"--- Sheet: {ws.title} ---")
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i >= max_rows_per_sheet:
                    break
                cells = [str(v) for v in row if v is not None and str(v).strip() != ""]
                if cells:
                    parts.append(" | ".join(cells))
    except Exception:
        log.exception("Failed to extract text from Excel attachment")
    return "\n".join(parts)


def attachment_to_text(name: str, content_type: str, data: bytes) -> str:
    lower_name = name.lower()
    if lower_name.endswith(".pdf") or content_type == "application/pdf":
        return pdf_bytes_to_text(data)
    if lower_name.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in content_type:
        return xlsx_bytes_to_text(data)
    log.info("Skipping attachment %s (%s) — unsupported type for extraction", name, content_type)
    return ""


def extract_original_external_sender(body_html: str, internal_domains: set[str]) -> tuple[str, str] | None:
    """Finds the real vendor identity when the polled mailbox's immediate sender is one of OUR
    OWN staff forwarding/replying on an existing vendor thread, rather than the vendor
    themselves — confirmed live: an internal Ozellar Accounts person replied on a Navarino SOA
    thread from her own address, and since ingest.py otherwise always trusts the immediate
    sender as vendor identity (deliberately — see SoaDocument docstring on why vendor identity
    must come from the sender, never guessed from body content), that created a bogus separate
    "vendor" for a purely internal forward.

    Outlook bakes the original message's headers into the HTML body on every reply/forward
    ("From: Andreas Tanios <andreas.tanios@navarino.gr>" — confirmed live in real Shell/ABS/
    Navarino samples), so this is deterministically regex-extractable rather than needing the
    LLM to guess it — same "don't trust the LLM for vendor identity" stance as everywhere else
    in this module. Returns (name, email) of the FIRST quoted "From:" whose domain is external,
    scanning top-to-bottom (the internal person's own forward marker is followed immediately by
    the original vendor email's header in a typical reply chain), or None if no external
    "From:" is found at all (falls back to treating the internal sender as-is — see caller)."""
    text = html_body_to_text(body_html)
    for name, email in _QUOTED_FROM_RE.findall(text):
        domain = email.rsplit("@", 1)[-1].lower()
        if domain not in internal_domains:
            return name.strip(" |\t"), email.strip().lower()
    return None


def build_document_text(body_html: str, attachments: list[dict]) -> str:
    """Combines the email body and every extractable attachment into one blob, each part
    labeled, so the extraction prompt can see everything at once — confirmed live that vendors
    sometimes split context across both (e.g. Den-Jet's body states the total/currency while the
    actual line items are only in the attached .xlsx)."""
    sections = ["=== Email body ===", html_body_to_text(body_html)]
    for att in attachments:
        text = attachment_to_text(att["name"], att["content_type"], att["bytes"])
        if text.strip():
            sections.append(f"=== Attachment: {att['name']} ===")
            sections.append(text)
    return "\n\n".join(sections)
