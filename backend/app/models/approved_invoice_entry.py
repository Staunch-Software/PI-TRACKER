import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

payment_status_enum = ENUM("PAID", "NOT_PAID", name="payment_status", create_type=False)


class ApprovedInvoiceEntry(Base):
    """One row per SmartPAL "Finally Approved" invoice for the 4 AMNS-fleet vessels (AMNS Polar,
    AMNS Tufmax, AMNSI Maximus, AMNSI Stallion) — scraped from Purchase > Transactions > Invoice
    Approval (Purchase/InvoiceList, tab FNL). Same JSON-API family as pir_entries (confirmed live
    2026-09-09: PurchasePALApp/api/ServiceRouter/POST, same account/session as the PIR scraper).

    LIVE snapshot, same upsert-by-smartpal_invoice_id convention as pir_entries — EXCEPT
    payment_status, which is ours: set only on first insert, NEVER overwritten by a later scrape
    (see app/services/approved_invoice_scraper/scraper.py's upsert loop). SmartPAL's own
    "paidStatus" field on this endpoint was confirmed null/unused on every row seen live, so we
    don't read it at all — payment_status is purely app-managed, same "computed/owned
    independently of the scrape" stance as PIR's assigned_vessel_id.

    vessel_id is a plain exact-match FK, not fuzzy like pir_entries.vessel_group — only 4 known
    vessel names ever appear here, confirmed live in the "Finally Approved" tab, so there's no
    naming-variant problem to solve the way PIR's fleet-wide vendor field had.
    """

    __tablename__ = "approved_invoice_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)

    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=True)

    amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    currency_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    po_nos: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    forward_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attachment: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    grn_exists: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Ours — see class docstring. Scraper sets this only on first insert.
    payment_status: Mapped[str] = mapped_column(payment_status_enum, nullable=False, default="NOT_PAID")

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
