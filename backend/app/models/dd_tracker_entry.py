import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, FetchedValue, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class DdTrackerEntry(Base):
    """One row per PR/PO the Purchase team is manually tracking through a dry dock (or OPEX)
    follow-up cycle — the "DD Tracker" module, modeled directly on the user's own
    "DD & OPEX" Excel sheet.

    Deliberately NOT auto-populated from every scraped pr_entries/po_entries row (there are
    thousands of those, only a small curated subset is ever tracked here) — a row is created by
    the team picking a requisition_no and/or po_no to track (matching this app's "DD Tracker"
    add-row flow), same spirit as PiEntry rows being created one at a time rather than bulk-synced
    from an external system.

    requisition_no / po_no are plain text, NOT foreign keys into pr_entries/po_entries — a team
    member may start tracking a PR before SmartPAL has assigned a PO yet (or vice versa for a
    Direct PO with no requisition), and the scraper's own upsert cycle shouldn't be coupled to
    row-level FK integrity here. The API layer joins against pr_entries.requisition_no /
    po_entries.po_no at read time to surface live status/vendor/amount/etc. alongside these manual
    fields, same "join live, don't duplicate" stance as PirEntry's department classification.

    Column provenance (see the live SmartPAL field investigation, 2026-10-27/28):
      - PR Status / Order status are the TEAM's own free-text follow-up notes — SmartPAL's own PR
        narrative status is a separate field (pr_entries.status) already surfaced via the join,
        not duplicated here.
      - Readiness date is manual by the user's own instruction (the team updates it directly, not
        the various readiness-looking SmartPAL fields — see po_entry.py docstring).
      - Invoice number/amount/currency/status are NOT stored here — same "join live, don't
        duplicate" stance as PR/PO — they're read live from smartpal_invoice_entries, matched by
        its po_nos field against this row's po_no (see api/routes/dd_tracker.py). A PO can in
        principle have more than one invoice (partial invoicing); the join surfaces the most
        recently scraped one. Invoice Type has no equivalent live field (confirmed live 2026-10-28
        every SmartPAL invoice row's closest candidate, dspInvoice, was "PO" on 100% of rows
        sampled — no real variation to key off), so it stays manual.
      - payment_status is not sourced from any scraper yet, so it stays manual here for now.
    """

    __tablename__ = "dd_tracker_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    seq_no: Mapped[int] = mapped_column(nullable=False, server_default=FetchedValue())

    entry_type: Mapped[str | None] = mapped_column(Text, nullable=True)  # "DD" / "OPEX" / etc., free text
    requisition_no: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    po_no: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)  # team's own label, independent of PR/PO title

    # ── Manual follow-up fields (team-entered, never touched by any scraper) ──────────────
    pr_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    lead_days: Mapped[int | None] = mapped_column(nullable=True)
    readiness_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    ex_stock: Mapped[str | None] = mapped_column(Text, nullable=True)
    supply_confirmation: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_status: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
