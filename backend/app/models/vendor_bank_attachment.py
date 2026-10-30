import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorBankAttachment(Base):
    """A document a user uploaded against a tracked vendor's bank-details-request workflow (e.g.
    the vendor's emailed reply, a cancelled cheque, a signed bank letter) — mirrors
    InvoiceAttachment field-for-field, just FK'd to vendor_tracker_entries instead of pi_entries.
    """

    __tablename__ = "vendor_bank_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    vendor_tracker_entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vendor_tracker_entries.id", ondelete="CASCADE"), nullable=False
    )
    blob_container: Mapped[str] = mapped_column(Text, nullable=False, default="vendor-attachments")
    blob_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
