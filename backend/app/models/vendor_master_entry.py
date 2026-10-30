import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorMasterEntry(Base):
    """One row per SmartPAL vendor (Purchase > Vendor, "VendorMaster" grid — ~1,098 vendors across
    the whole fleet, not scoped to any category). Feeds the Vendor Management module's "Add DD
    Vendor" picker and its live-joined vendor fields, same "join live, don't duplicate" stance as
    pr_entries/po_entries for DD Tracker.

    Two scrapes populate different halves of this row, deliberately never clobbering each other:

      - The NIGHTLY list scrape (vendor_master_scraper/scraper.py) sweeps every vendor from the
        grid and upserts only the list-scrape columns below (vendor_name/email/city/etc.) — cheap
        enough to run fleet-wide twice daily, and sufficient for the picker's "type a vendor name,
        see suggestions" flow.
      - The ON-DEMAND detail scrape (vendor_master_scraper/detail_scraper.py) only runs once a
        vendor is actually added to vendor_tracker_entries, and fills in the detail-scrape columns
        (address/phone_1/contacts/etc.) from that vendor's own "Vendor Contacts" tab. It is NOT run
        for all ~1,098 vendors proactively — confirmed with the user 2026-10-30, scraping every
        vendor's detail page nightly would be far too heavy on the shared SmartPAL login session.

    phone_1 stands in for "Mobile Number" in the mandatory-details check (Email/Address/Mobile) —
    confirmed with the user 2026-10-30 there is no vendor-level Mobile field in SmartPAL at all,
    only Phone 1/Phone 2 at vendor level and a Mobile field per individual contact in the Vendor
    Contacts sub-grid (stored here as `contacts`, display-only, never itself validated).
    """

    __tablename__ = "vendor_master_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    # ── List-scrape columns (nightly, all ~1,098 vendors) ──────────────────────────────────
    vendor_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)
    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vendor_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str | None] = mapped_column(Text, nullable=True)
    city: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # ── Detail-scrape columns (on-demand only — null until a user adds this vendor) ────────
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_1: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone_2: Mapped[str | None] = mapped_column(Text, nullable=True)
    fax_1: Mapped[str | None] = mapped_column(Text, nullable=True)
    fax_2: Mapped[str | None] = mapped_column(Text, nullable=True)
    telex: Mapped[str | None] = mapped_column(Text, nullable=True)
    website: Mapped[str | None] = mapped_column(Text, nullable=True)
    zip_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Raw Vendor Contacts sub-grid (named people, each with their own email/mobile/designation) —
    # a single JSONB column rather than a child table, since it's display-only and never filtered/
    # sorted on independently (confirmed with the user 2026-10-30).
    contacts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    detail_scraped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
