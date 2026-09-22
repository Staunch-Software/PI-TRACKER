import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field

from app.core.enums import SoaMatchSource
from app.schemas.base import CamelModel


class SoaLineItemOut(CamelModel):
    id: uuid.UUID
    soa_document_id: uuid.UUID

    invoice_number: str
    invoice_date: date | None
    amount: Decimal | None
    remaining_amount: Decimal | None
    currency: str | None

    vessel_name_raw: str | None
    vessel_id: uuid.UUID | None
    vessel_name: str | None  # resolved from vessels table, null if unmatched

    match_source: SoaMatchSource
    match_status_label: str | None
    matched_entry_id: uuid.UUID | None
    matched_at: datetime | None

    # From the parent soa_documents row (see api/routes/soa_entries.py join) — vendor identity
    # is the SENDER's, never parsed out of the document body (see SoaDocument docstring).
    vendor_name_raw: str | None
    sender_email: str
    sender_domain: str
    # The vendor-identity key used for grouping in the UI (see SoaDocument.canonical_domain
    # docstring) — resolves domain aliases (e.g. Navarino's navarino.gr/navarino.com.cy) to one
    # vendor, unlike sender_domain which is just the raw value as it arrived.
    canonical_domain: str
    has_attachment: bool
    soa_subject: str | None
    soa_received_at: datetime

    created_at: datetime


class SoaMatchSourceCounts(CamelModel):
    smartpal: int
    pir: int
    invoice_mail: int
    # "none" collides with the Python builtin — explicit alias, same pattern as
    # PirDepartmentCounts.all_ (see pir_entry.py).
    none_: int = Field(alias="none")


class SoaKpisOut(CamelModel):
    total_line_items: int
    total_vendors: int
    by_match_source: SoaMatchSourceCounts
    needs_triage_count: int  # match_source == NONE
    total_outstanding_by_currency: dict[str, Decimal]


class SoaRematchResult(CamelModel):
    matched_count: int
