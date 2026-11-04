import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, FetchedValue, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorTrackerEntry(Base):
    """One row per vendor the Purchase team is tracking through the Vendor Management module's
    bank-details-request / bank-verification workflow — modeled on DD Tracker's own "join live,
    don't duplicate" stance.

    vendor_code is a plain text natural key into vendor_master_entries.vendor_code, not a foreign
    key — same reasoning as DD Tracker's requisition_no/po_no text-key joins, keeping this table
    decoupled from the scraper's own upsert cycle. vendor_name/email/address/phone_1/city/country
    are NEVER duplicated here — always read live from vendor_master_entries at API read time (see
    api/routes/vendor_management.py).

    The one deliberate exception is the bank_* override fields below: these are intentionally
    duplicated/overridable, since a purchaser types them in by hand after reviewing whatever the
    vendor emails back (which may differ from, or fill in gaps in, whatever vendor_bank_details
    already has scraped from SmartPAL) — not a live mirror of anything.

    bank_details_status progression (plain Text, not a DB enum — see BankDetailsStatus in
    core/enums.py) is entirely manual, confirmed with the user 2026-10-30 there is no automated
    reply-parsing: missing -> requested (send-bank-request clicked) -> received (someone manually
    marks the vendor's reply as received) -> updated (purchaser keyed in the bank_* fields and
    confirmed). bank_verification_completed is a separate, one-way manual flag, only settable once
    bank_details_status has reached "updated" (enforced in the route, not here).
    """

    __tablename__ = "vendor_tracker_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    seq_no: Mapped[int] = mapped_column(nullable=False, server_default=FetchedValue())

    vendor_code: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)

    # Classification only — confirmed with the user 2026-11-04: "All Vendors" and "DD Vendors" in
    # the UI are the SAME underlying rows, not two datasets. This flag is the only thing that
    # distinguishes them; every other column here is shared regardless of its value. A row can
    # exist with this False (created lazily the first time any action is taken on a vendor from
    # the All Vendors tab — see api/routes/vendor_management.py's ensure-tracking endpoint) and
    # later flip True via "+ Add DD Vendor" without losing any of its tracked state.
    is_dd_vendor: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # ── Bank-details-request workflow ───────────────────────────────────────────────────────
    bank_details_status: Mapped[str] = mapped_column(Text, nullable=False, default="missing")
    bank_request_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bank_request_sent_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    bank_details_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bank_details_received_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    bank_details_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bank_details_updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    # ── Manually-keyed bank field overrides ─────────────────────────────────────────────────
    # Retired 2026-11-04: nothing writes to these anymore (the "Enter/Edit Bank Fields" UI was
    # removed in favor of relying solely on vendor_bank_details, SmartPAL's own scraped Bank
    # Details tab — see bank_details_in_pal_complete/_missing_fields on VendorTrackerEntryOut).
    # Columns kept rather than dropped to avoid a destructive migration; safe to remove later.
    bank_beneficiary_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_branch_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_iban: Mapped[str | None] = mapped_column(Text, nullable=True)
    bank_swift_code: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Bank verification — separate, one-way, manual ───────────────────────────────────────
    bank_verification_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    bank_verification_completed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    bank_verification_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
