import uuid
from decimal import Decimal

from app.core.enums import Currency, FollowUpStatus
from app.schemas.base import CamelModel


class DashboardKpisOut(CamelModel):
    total: int
    received: int
    not_followed_up: int
    reminder_sent: int
    internal_check: int
    discrepancy: int
    scheduled: int
    other: int
    not_applicable: int
    overdue30_plus: int


class OverdueEntryOut(CamelModel):
    id: uuid.UUID
    dpr_no: str
    vessel_name: str
    vendor_name: str
    amount_inr: Decimal | None
    currency: Currency
    days_since_payment: int
    followup_status: FollowUpStatus
