import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PoEntry(Base):
    """One row per SmartPAL Purchase Order (Purchase > PO Overview, "All" tab) — scraped the same
    way as pr_entries: set the date pickers, click the real "All" tab (confirmed live 2026-10-27
    this POSTs {..., "approvalFlag": "8", ...} — SmartPAL's internal numeric code for the "All"
    tab, NOT a stable/documented value, just whatever a live click produced), and read the
    resulting api/ServiceRouter/POST JSON response.

    CONFIRMED DEAD END (2026-10-27): the request body carries an "isShowDrydoksPO" boolean that
    looks purpose-built for exactly this app's use case, but toggling it true/false against a live
    session returned the identical totalCount both times — it does not actually filter anything in
    this account's data. So dry-dock scoping is NOT done via that flag; it's done entirely inside
    this app, by filtering req_category the same way the user's own manually-maintained Excel
    tracker already did (categories prefixed "DD -"), same stance as pr_entries.

    LIVE-SNAPSHOT / upsert-by-po_no — a PO's approval/invoice/readiness status changes constantly
    after creation, so every scrape run upserts.

    confirmed_date is used as "PO Acknowledged date" in the DD tracker UI — SmartPAL has no field
    literally named "acknowledged"; this was the closest semantic match of the 3 date-like
    candidates (confirmedDate / issueDate / effectiveDate) the user looked at, confirmed live
    2026-10-27. Swap this mapping if a live comparison later shows it's wrong.

    requisition_no is a denormalized copy of this PO's own "reqNos" field (plural in SmartPAL,
    but observed single-valued on every row checked) — the link back to pr_entries.requisition_no.
    A PO created without a requisition ("Direct PO" in SmartPAL's own poType field) has this null.
    """

    __tablename__ = "po_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    po_no: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)
    requisition_no: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)

    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vendor: Mapped[str | None] = mapped_column(Text, nullable=True)
    req_category: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    po_type: Mapped[str | None] = mapped_column(Text, nullable=True)  # e.g. "Direct PO"

    base_amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    base_currency: Mapped[str | None] = mapped_column(Text, nullable=True)

    approved_status: Mapped[str | None] = mapped_column(Text, nullable=True)  # "Finally Approved", "Cancelled", etc.
    invoice_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    po_sent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    created_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    approved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    confirmed_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # "PO Acknowledged date" — see docstring

    schd_del_port: Mapped[str | None] = mapped_column(Text, nullable=True)  # "Supply Port"
    agent_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    warehouse_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    grn_nos: Mapped[str | None] = mapped_column(Text, nullable=True)
    do_nos: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)  # SmartPAL's own remarks field

    pending_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    priority: Mapped[str | None] = mapped_column(Text, nullable=True)
    critical: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
