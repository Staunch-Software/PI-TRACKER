import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, FetchedValue, ForeignKey, Numeric, Text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.enums import Currency, FollowUpStatus
from app.db.base import Base

currency_enum = ENUM("INR", "USD", "EUR", name="currency_code", create_type=False)
followup_status_enum = ENUM(
    "PENDING_NOT_YET_FOLLOWED_UP",
    "PENDING_REMINDER_SENT",
    "PENDING_INTERNAL_CHECK",
    "PENDING_DISCREPANCY_TO_RESOLVE",
    "PENDING_SCHEDULED",
    "PENDING_OTHER",
    "RECEIVED",
    "NOT_APPLICABLE",
    name="followup_status",
    create_type=False,
)


class PiEntry(Base):
    __tablename__ = "pi_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    # SERIAL in the raw-SQL migration (pi_entries_seq_no_seq); server_default tells the ORM
    # to omit it from INSERT and fetch the DB-generated value back instead of sending NULL.
    seq_no: Mapped[int] = mapped_column(nullable=False, server_default=FetchedValue())
    dpr_no: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    dpr_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=False)
    vendor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vendors.id"), nullable=False)
    service_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount_inr: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    fc_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[Currency] = mapped_column(currency_enum, nullable=False, default=Currency.INR)
    payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    followup_status: Mapped[FollowUpStatus] = mapped_column(
        followup_status_enum, nullable=False, default=FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP
    )
    last_known_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    reminder_1_sent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reminder_2_sent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    final_invoice_received: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    invoice_file_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    attached_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    date_attached: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
