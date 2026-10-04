import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PirRejection(Base):
    """One row per SmartPAL PIR invoice's "REJECTED" audit-trail entry — who rejected it and when
    — scraped from the "Problematic Invoice Overview" page's "Rejected invoice" category (the same
    page pir_scraper already sweeps for pir_entries, pCategoryId=-100) via each row's "Audit
    Trial" icon. Confirmed live 2026-10-02: clicking that icon fires
    `AccountsPALApp/api/ServiceRouter/GET?pData=pInvoiceId={id}`, a clean JSON `{"result": [...]}`
    array of {action, actionBy, actionDate, remarks} rows — no vessel-context headers needed
    (unlike the unrelated Purchase-module "Pending List" endpoint), so a real click (JS-dispatched,
    see pir_scraper/scraper.py — the grid's own column-header tooltip icon shares the same `title`
    attribute as the real per-row icon and must be excluded) is still required to get a 200
    instead of a 500, but no page navigation/pager-position recovery is needed since the audit
    trail opens inline on the same list page.

    Upsert-by-smartpal_invoice_id like pir_entries (NOT insert-once like invoice_registrations) is
    deliberately NOT done here — once scraped, a rejection record is treated as final and never
    re-fetched, same tradeoff as invoice_registrations: a rejected invoice could in principle be
    un-rejected and re-rejected later with a different actor, which this would miss, but
    re-fetching the full "Rejected invoice" category every run (800+ rows) for a rare edge case
    isn't worth the added run time. Revisit if this turns out to matter in practice.
    """

    __tablename__ = "pir_rejections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)

    rejected_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    rejected_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_json: Mapped[list] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
