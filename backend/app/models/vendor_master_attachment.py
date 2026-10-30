import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class VendorMasterAttachment(Base):
    """A document the SmartPAL on-demand detail scrape found on a vendor's own attachment list
    (certs, declarations, bank letterhead, etc. — see the Vendor Master page's paperclip icon) and
    downloaded into our own Azure Blob storage. System-sourced (no uploaded_by) — kept separate
    from vendor_bank_attachments (user-uploaded bank-reply documents), which has a different parent
    (a specific vendor_tracker_entries row, not every vendor_master_entries row) and a different
    lifecycle (user-initiated SAS upload, not scraper-managed).
    """

    __tablename__ = "vendor_master_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    vendor_code: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    blob_container: Mapped[str] = mapped_column(Text, nullable=False, default="vendor-attachments")
    blob_key: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # SmartPAL's own "Uploaded By"/"Date & Time" columns on its Attachment Details modal — kept as
    # plain text (not FK'd to our own users table, since these are SmartPAL's own user names).
    smartpal_uploaded_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    smartpal_uploaded_at: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)

    downloaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
