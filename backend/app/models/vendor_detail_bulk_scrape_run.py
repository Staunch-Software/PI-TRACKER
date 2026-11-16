import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorDetailBulkScrapeRun(Base):
    """One row per "Scrape All Vendor Details" run (All Vendors tab) — tracks progress of the
    background job in services/vendor_master_scraper/detail_scraper.py's run_bulk_detail_scrape(),
    which walks every vendor_master_entries row with no detail_scraped_at yet, one vendor at a
    time (see that module's own docstring for why it can't run concurrently).

    Exists because production runs gunicorn with multiple worker processes — an in-memory Python
    progress counter wouldn't be visible to the API requests a different worker serves, so progress
    has to live here instead. Rows are kept for history rather than reused/overwritten; the latest
    one by started_at is what the "status" endpoint and the frontend's poll read.
    """

    __tablename__ = "vendor_detail_bulk_scrape_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    # "running" / "completed" / "failed" — plain text, same lighter-weight convention as
    # BankDetailsStatus (core/enums.py), not a DB enum.
    status: Mapped[str] = mapped_column(Text, nullable=False, default="running")

    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    succeeded: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # The vendor_code currently being (or most recently) scraped — lets the UI show "currently: X"
    # without needing its own separate log stream.
    current_vendor_code: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    started_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
