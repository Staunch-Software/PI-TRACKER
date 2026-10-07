import uuid
from datetime import date, datetime

from sqlalchemy import Date, FetchedValue, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.base import Base


class LandingReport(Base):
    __tablename__ = "landing_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    # SERIAL in the migration (landing_reports_seq_no_seq) — the system-generated S.No, never
    # supplied by the client. Same FetchedValue convention as PiEntry.seq_no.
    seq_no: Mapped[int] = mapped_column(nullable=False, server_default=FetchedValue())
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=False)
    port: Mapped[str | None] = mapped_column(Text, nullable=True)
    oil_type: Mapped[str] = mapped_column(Text, nullable=False)
    offlanded_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    shipment_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=func.now(), onupdate=func.now())

    vessel = relationship("Vessel")
