import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import ENUM, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base

vendor_department_enum = ENUM("TECHNICAL", "MANNING", name="vendor_department", create_type=False)


class VendorDepartmentMapping(Base):
    __tablename__ = "vendor_department_mapping"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    vendor_name: Mapped[str] = mapped_column(Text, nullable=False)
    vendor_name_normalized: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    department: Mapped[str] = mapped_column(vendor_department_enum, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
