import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PrEntry(Base):
    """One row per SmartPAL Purchase Requisition (Purchase > Requisition Approval, "All" tab) —
    scraped the same way as pir_entries: set the Kendo date pickers, click the real "All" tab, and
    read the resulting api/ServiceRouter/POST JSON response rather than the grid DOM. Confirmed
    live 2026-10-27 that this grid's "All" tab POSTs {..., "status": "ALL", ...} and returns the
    full row set with no pagination quirks, same as PIR.

    LIVE-SNAPSHOT / upsert-by-requisition_no, like pir_entries — a requisition's status/approver
    can change after the fact, so every scrape run upserts rather than skip-if-seen.

    This covers EVERY requisition across the whole fleet from FROM_DATE onward (see scraper.py) —
    deliberately NOT filtered to dry-dock categories at scrape time (the user's call: scope
    everything now, filter to dry-dock items inside this app later via req_category, rather than
    trying to get SmartPAL's own filters to do it — see po_entry.py docstring on
    isShowDrydoksPO being a dead end). Rows whose req_category is one of the crew categories
    (CREWING / CREW WAGES / CREW EXPENSES and their NB/PD/DD/OPEX variants) are skipped entirely
    at scrape time — see scraper.py's _EXCLUDED_CATEGORIES — since the user confirmed those are
    never relevant to this app.
    """

    __tablename__ = "pr_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    # SmartPAL's own internal row id ("id" in the JSON) — kept for forward-compat, NOT the
    # upsert key (that's requisition_no, the human-facing PR number everyone actually references).
    smartpal_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    requisition_no: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)

    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    req_category: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    department: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SmartPAL's own narrative status ("RFQ Created", "Requisition Approved", etc.) — NOT the same
    # as the team's own manual follow-up notes on dd_tracker_entries.pr_status, see that model.
    status: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str | None] = mapped_column(Text, nullable=True)
    critical: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    pending_since: Mapped[int | None] = mapped_column(Integer, nullable=True)
    item_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    required_before: Mapped[date | None] = mapped_column(Date, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
