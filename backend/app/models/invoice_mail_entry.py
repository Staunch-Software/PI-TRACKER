import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class InvoiceMailEntry(Base):
    """One extracted invoice line from the invoice@ozellar.com mailbox — the 3rd-priority match
    source for SOA reconciliation (see SoaLineItem docstring): an invoice the system only knows
    about because a copy of it arrived by mail, with no corresponding SmartPAL or PIR record yet.

    Same LLM-extraction approach as SOA documents (soa_extraction/), since invoice email/
    attachment layout varies just as much. Deliberately a flat live-snapshot table like
    approved_invoice_entries, not versioned/soft-deleted like soa_documents — an invoice mail
    doesn't get "superseded" by a later one the way a vendor's rolling SOA does; each message is
    its own independent invoice record, upserted by graph_message_id + invoice_number_normalized.
    """

    __tablename__ = "invoice_mail_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    graph_message_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    sender_email: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    invoice_number: Mapped[str] = mapped_column(Text, nullable=False)
    invoice_number_normalized: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor_name_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_name_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
