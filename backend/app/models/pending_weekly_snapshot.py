from datetime import date, datetime
from sqlalchemy import Column, Date, DateTime, Integer, String, UniqueConstraint
from app.db.base import Base


class PendingWeeklySnapshot(Base):
    __tablename__ = "pending_weekly_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    week_index = Column(Integer, nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    vessel_name = Column(String(100), nullable=False, index=True)
    owner_role = Column(String(10), nullable=False, index=True)
    owner_name = Column(String(100), nullable=False)
    requisition_count = Column(Integer, default=0, nullable=False)
    po_count = Column(Integer, default=0, nullable=False)
    invoice_count = Column(Integer, default=0, nullable=False)
    total_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("week_index", "vessel_name", "owner_role", name="uq_snapshot_week_vessel_role"),
    )
