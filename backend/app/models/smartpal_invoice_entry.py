import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class SmartpalInvoiceEntry(Base):
    """One row per SmartPAL invoice across ALL statuses (Pending Approval, Finally Approved,
    Rejected, etc. — whatever tabs/filters the Purchase > Transactions > Invoice Approval page
    exposes), NOT just the "Finally Approved" AMNS-fleet subset that approved_invoice_entries
    tracks. Purpose-built as the 1st-priority match source for SOA reconciliation (see
    SoaLineItem docstring) — a user checking an SOA line needs to see the invoice's REAL current
    SmartPAL state ("still Pending", "Rejected", etc.), not just whether it happens to be in the
    narrower Finally-Approved table.

    Deliberately a separate table from approved_invoice_entries rather than broadening that one:
    approved_invoice_entries has its own distinct purpose (the app-owned payment_status
    Paid/Not-Paid workflow, scoped to the 4 AMNS vessels only) and mixing "every status, every
    vendor/vessel" into it would blur that. This table is populated by a scraper extension still
    to be built — see PR notes — that widens scope beyond the 4 AMNS vessels and the Finally
    Approved tab; until that lands, this table exists as the schema SOA matching reads from, but
    will be empty / only partially populated.

    Same live-snapshot upsert convention as pir_entries/approved_invoice_entries — status text is
    SmartPAL's own live value, so re-running the scrape after an invoice moves from Pending to
    Finally Approved updates status in place rather than creating a new row.
    """

    __tablename__ = "smartpal_invoice_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)

    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_no_normalized: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vendor_invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=True)

    amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # SmartPAL's own status text (e.g. "Pending Approval", "Finally Approved", "Rejected") —
    # surfaced as-is in match_status_label, see SoaLineItem docstring.
    status: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
