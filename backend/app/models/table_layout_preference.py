import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class TableLayoutPreference(Base):
    __tablename__ = "table_layout_preferences"
    __table_args__ = (UniqueConstraint("user_id", "table_key", name="uq_table_layout_user_table"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    table_key: Mapped[str] = mapped_column(Text, nullable=False)
    column_order: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    column_widths: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    page_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())
