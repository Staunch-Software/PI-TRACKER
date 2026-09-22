# ===========================================================================
# backend/app/services/soa_scraper/ollama_extractor.py
#
# Structured extraction of SOA/invoice line items via a self-hosted Ollama model (never the
# Anthropic API — SOA/invoice content never leaves the network). Confirmed live against real
# vendor samples (Shell — aggregate SOA with no vessel column; Den-Jet — per-vessel Excel with
# vessel identity buried in free text like 'To Master/Owners of Vessel "GCL NARMADA"') that a
# fixed-schema LLM prompt handles arbitrary vendor layouts correctly where a hand-coded per-vendor
# column parser could not scale to every new vendor format.
#
# Two things confirmed load-bearing in testing, both reflected below:
#  - Ollama's `format` must be an object schema (a top-level JSON array is NOT supported by
#    `format: "json"` and silently collapses to one item) — always wrap as {"line_items": [...]}.
#  - vendor_name must be passed IN as known context (from the email's From/sender-domain, via
#    Microsoft Graph), never asked of the model — confirmed live that the model mislabels the
#    CUSTOMER named inside the document body (e.g. "OZELLAR GLOBAL PTE. LTD.") as the vendor
#    when asked to infer it from content.
# ===========================================================================
import json
import logging
from dataclasses import dataclass

import requests

from app.core.config import settings

log = logging.getLogger(__name__)

_LINE_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "invoice_number": {"type": "string"},
                    "invoice_date": {"type": ["string", "null"]},
                    "amount": {"type": ["number", "null"]},
                    "remaining_amount": {"type": ["number", "null"]},
                    "currency": {"type": ["string", "null"]},
                    "vessel_name": {"type": ["string", "null"]},
                },
                "required": ["invoice_number", "invoice_date", "amount", "remaining_amount", "currency", "vessel_name"],
            },
        }
    },
    "required": ["line_items"],
}

_PROMPT_TEMPLATE = """This is a vendor {document_kind} document, sent by "{sender_name}" at domain {sender_domain}.
Extract EVERY invoice line item from the document below. Do not skip any rows, and do not invent rows that aren't there.

Rules:
- "{sender_name}" / {sender_domain} is the VENDOR sending this document. Any other company name mentioned
  (e.g. the customer/recipient the statement is addressed to) is NOT the vendor — ignore it, don't extract it as a field.
- invoice_number: the invoice/billing/reference/voucher number for that line.
- invoice_date: ISO format YYYY-MM-DD if determinable, else the date as shown, else null.
- amount: the original invoice amount, numeric only (no currency symbols or thousands separators).
- remaining_amount: the amount still outstanding if the document distinguishes it from the original amount
  (e.g. after a partial payment); otherwise same as amount.
- currency: 3-letter currency code if shown, else null.
- vessel_name: if the line names a real ship/vessel (including phrasings like 'To Master/Owners of Vessel "X"' or
  'Master & Owners of X'), extract just the clean vessel name X. If the line instead names a company/organization
  (not a ship), or no vessel is mentioned at all, set vessel_name to null. Do not guess a vessel name.

Return ONLY a JSON object of this shape: {{"line_items": [{{"invoice_number": "...", "invoice_date": "YYYY-MM-DD", "amount": 0.0, "remaining_amount": 0.0, "currency": "...", "vessel_name": null}}]}}

Document:
{document_text}
"""


@dataclass
class ExtractedLineItem:
    invoice_number: str
    invoice_date: str | None
    amount: float | None
    remaining_amount: float | None
    currency: str | None
    vessel_name: str | None


def extract_line_items(
    document_text: str,
    *,
    sender_name: str,
    sender_domain: str,
    document_kind: str = "Statement of Account (SOA)",
    timeout: int = 900,
) -> list[ExtractedLineItem]:
    """Blocking call — a single extraction can take minutes on a CPU-only Ollama host (confirmed
    live: ~500s for 13 rows on a laptop with no dedicated GPU). Caller (ingest.py) runs this
    per-message in a background poll, not on any request/response path."""
    if not document_text.strip():
        return []

    prompt = _PROMPT_TEMPLATE.format(
        document_kind=document_kind,
        sender_name=sender_name or "Unknown Vendor",
        sender_domain=sender_domain or "unknown",
        document_text=document_text,
    )

    resp = requests.post(
        f"{settings.ollama_base_url}/api/generate",
        json={"model": settings.ollama_model, "prompt": prompt, "stream": False, "format": _LINE_ITEM_SCHEMA},
        timeout=timeout,
    )
    resp.raise_for_status()
    raw = resp.json()["response"]

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        log.error("Ollama extraction returned invalid JSON: %s", raw[:500])
        return []

    items = []
    for row in parsed.get("line_items", []):
        invoice_number = (row.get("invoice_number") or "").strip()
        if not invoice_number:
            continue
        items.append(
            ExtractedLineItem(
                invoice_number=invoice_number,
                invoice_date=row.get("invoice_date"),
                amount=row.get("amount"),
                remaining_amount=row.get("remaining_amount") if row.get("remaining_amount") is not None else row.get("amount"),
                currency=row.get("currency"),
                vessel_name=row.get("vessel_name"),
            )
        )
    return items
