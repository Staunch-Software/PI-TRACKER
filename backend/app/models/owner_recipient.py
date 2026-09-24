import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class OwnerRecipient(Base):
    """Admin-managed list of email addresses that receive the "send owner reminder" email (see
    api/routes/pi_entries.py send-owner-reminder) — deliberately NOT tied to Vessel, since the
    user confirmed all vessels share the same owner, so this is one small flat list rather than
    a per-vessel contact. Kept editable via the app (not hardcoded config) since owner contacts
    can change without needing a code deploy — same "small admin-curated list" convention as
    vendor_department_mapping / soa_vendor_domain_aliases.
    """

    __tablename__ = "owner_recipients"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
