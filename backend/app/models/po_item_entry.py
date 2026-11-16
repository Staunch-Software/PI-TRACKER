import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PoItemEntry(Base):
    """One row per line item or additional charge scraped from SmartPAL's POCreation page
    (Purchase > POCreation) for Purchase Orders tracked in DD Tracker.
    """

    __tablename__ = "po_item_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    smartpal_po_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    po_no: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)

    item_type: Mapped[str] = mapped_column(Text, nullable=False, default="ITEM")  # "ITEM" or "ADDITIONAL"
    account_code: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    account_code_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    part_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    rob: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    discount_pct: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    total_amount_inr: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    total_amount_usd: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)

    vat_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    vat_pct: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    sub_account_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    analysis_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    drawing_no: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
