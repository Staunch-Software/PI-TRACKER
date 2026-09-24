import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Vessel(Base):
    __tablename__ = "vessels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    imo_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    # The TA (Editor/Admin user) responsible for this vessel — used as the "from" mailbox when
    # sending the automated vendor-notice/owner-reminder emails (see pi_reminder_mailer.py), so
    # the vendor/owner hear from the actual person handling their vessel rather than a shared
    # inbox. Nullable: falls back to the shared mailbox when a vessel has no TA assigned yet.
    assigned_ta_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assigned_ta = relationship("User", foreign_keys=[assigned_ta_id])
