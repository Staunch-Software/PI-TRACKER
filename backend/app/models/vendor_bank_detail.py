import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorBankDetail(Base):
    """Read-only mirror of a vendor's SmartPAL "Bank Details" tab rows (a vendor can have several,
    one marked Default/Active). Populated only by the on-demand detail scrape
    (vendor_master_scraper/detail_scraper.py) — delete+reinserted per vendor_code on each scrape,
    never edited in place, since this is a pure read-only reflection of SmartPAL's own data. The
    purchaser's own manually-keyed bank values (typed in after reviewing a vendor's emailed reply)
    live separately on vendor_tracker_entries, not here — see that model's docstring for why.

    Field names match the real SmartPAL "Bank Details" tab exactly (confirmed via screenshot
    2026-10-30) — notably there is no IFSC Code field there, only IBAN/Swift Code/ABA No.
    """

    __tablename__ = "vendor_bank_details"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    vendor_code: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    beneficiary_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    branch_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, nullable=True)
    account_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    iban: Mapped[str | None] = mapped_column(Text, nullable=True)
    swift_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    aba_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
