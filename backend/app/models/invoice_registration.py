import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class InvoiceRegistration(Base):
    """One row per SmartPAL invoice's "Registered" approval-chain step — who first registered it
    and when — scraped from Purchase > Invoice Approval's per-invoice "Pending List" (the clock
    icon on the Invoice Approval detail page). Confirmed live 2026-09-29: opening that modal fires
    `PurchasePALApp/api/ServiceRouter/GET?pData=docId={id}&docType=0&pageType=INV_DEF`, a bare
    JSON-array response of the full approval chain (Pending/Approved/Verified/Registered rows) —
    no detail-page navigation or click needed, just a direct authenticated GET per invoice id
    (the same `id` already present on every Invoice List row scraped by approved_invoice_scraper).

    Covers ALL invoices/vessels/categories (unlike approved_invoice_entries, which is scoped to
    the 4 AMNS-fleet vessels' Finally Approved tab) — scraped from the same "All" tab pass that
    feeds approved_invoice_entries, just without the AMNS-only filter.

    A registration event never changes once recorded, so this is fetched once per invoice ever
    seen and never re-fetched — see approved_invoice_scraper/scraper.py's run(), which only calls
    the Pending List endpoint for invoice ids not yet present in this table.
    """

    __tablename__ = "invoice_registrations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)

    registered_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    registered_action_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    raw_json: Mapped[list] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
