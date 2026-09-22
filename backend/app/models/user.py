import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import CITEXT, ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.core.enums import UserRole
from app.db.base import Base

user_role_enum = ENUM("ADMIN", "EDITOR", "VIEWER", name="user_role", create_type=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email: Mapped[str] = mapped_column(CITEXT, unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[UserRole] = mapped_column(user_role_enum, nullable=False, default=UserRole.VIEWER)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Per-user module access — independent of role, both default TRUE so this narrows access
    # rather than silently granting it. ADMIN always has full access regardless of these flags
    # (enforced in api/deps.py's require_module_access, not here) — see 0009_user_module_access.
    can_access_pi: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_access_pir: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    can_access_soa: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    password_reset_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
