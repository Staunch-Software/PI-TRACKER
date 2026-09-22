import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

soa_match_source_enum = ENUM("SMARTPAL", "PIR", "INVOICE_MAIL", "NONE", name="soa_match_source", create_type=False)


class SoaLineItem(Base):
    """One extracted invoice line from a vendor SOA (soa_documents), normalized by the Ollama
    extraction step (see soa_extraction/) since every vendor's SOA layout is different — column
    names, whether a vessel is even named per line (confirmed live: Shell's SOA has none at all,
    Den-Jet's does but sometimes names the vendor's own company instead of a ship), PDF vs Excel
    vs inline-HTML-table-in-the-email-body. There is no reliable per-vendor column parser, so
    extraction is LLM-based against a fixed target schema rather than hand-coded per format.

    match_source / match_status_label / matched_entry_id together answer "where does this
    invoice currently sit, and in what state" — NOT just found/not-found. Checked in this
    priority order every time matching is (re-)run:
      1. SMARTPAL — matched against smartpal_invoice_entries (ALL statuses scraped from the
         Invoice List, not just Finally Approved — see that model's docstring). match_status_label
         holds SmartPAL's own status text at match time (e.g. "Pending Approval", "Finally
         Approved"), so the same invoice can show a different label after a later re-match once
         its SmartPAL status has moved on.
      2. PIR — matched against pir_entries when not found in SmartPAL.
      3. INVOICE_MAIL — matched against invoice_mail_entries (extracted from invoice@ozellar.com)
         when not found in either of the above — the invoice is only known to exist because a
         copy of it arrived in the invoice mailbox, not because SmartPAL/PIR have record of it.
      4. NONE — none of the above; needs triage.

    Matching key is invoice_number (normalized — see normalize_invoice_number in
    soa_matching.py), cross-checked against amount where available, since invoice numbers are
    not guaranteed unique across vendors.

    amount vs remaining_amount: some vendor formats show both (an original invoice amount and
    what's still outstanding after partial payment — confirmed live in the Den-Jet sample);
    others only show one. remaining_amount is nullable and falls back to amount when a vendor
    format doesn't distinguish them.
    """

    __tablename__ = "soa_line_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    soa_document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("soa_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )

    invoice_number: Mapped[str] = mapped_column(Text, nullable=False)
    # Case/whitespace/leading-zero-insensitive key used for matching — see normalize_invoice_number.
    invoice_number_normalized: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    remaining_amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Raw text as extracted (e.g. 'To Master/Owners of Vessel "GCL NARMADA"' already cleaned down
    # to "GCL NARMADA" by the extraction prompt, or null when the vendor's SOA doesn't name a
    # vessel at all / names a company instead of a ship — see class docstring).
    vessel_name_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=True)

    match_source: Mapped[str] = mapped_column(soa_match_source_enum, nullable=False, default="NONE")
    match_status_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    matched_entry_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
