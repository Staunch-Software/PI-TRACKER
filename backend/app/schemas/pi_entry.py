import uuid
from datetime import date, datetime
from decimal import Decimal

from app.core.enums import Currency, FollowUpStatus
from app.schemas.base import CamelModel


class PiEntryOut(CamelModel):
    id: uuid.UUID
    seq_no: int
    dpr_no: str
    dpr_date: date | None
    vessel_id: uuid.UUID
    vessel_name: str
    vendor_id: uuid.UUID
    vendor_name: str
    service_details: str | None
    amount_inr: Decimal | None
    fc_amount: Decimal | None
    currency: Currency
    payment_date: date | None
    payment_reference: str | None
    days_since_payment: int | None
    followup_status: FollowUpStatus
    last_known_remark: str | None
    reminder_1_sent_date: date | None
    reminder_2_sent_date: date | None
    final_invoice_received: bool
    po_number: str | None
    invoice_no: str | None
    invoice_date: date | None
    invoice_file_name: str | None
    attached_by: uuid.UUID | None
    attached_by_name: str | None
    date_attached: datetime | None
    notes: str | None
    created_by: uuid.UUID
    created_at: datetime
    updated_by: uuid.UUID | None
    updated_at: datetime
    attachment_count: int


class PiEntryCreateRequest(CamelModel):
    dpr_no: str
    dpr_date: date | None = None
    vessel_id: uuid.UUID
    vendor_id: uuid.UUID
    service_details: str | None = None
    amount_inr: Decimal | None = None
    fc_amount: Decimal | None = None
    currency: Currency = Currency.INR
    payment_date: date | None = None
    payment_reference: str | None = None
    followup_status: FollowUpStatus = FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP
    last_known_remark: str | None = None
    reminder_1_sent_date: date | None = None
    reminder_2_sent_date: date | None = None
    final_invoice_received: bool = False
    po_number: str | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    notes: str | None = None


class PiEntryUpdateRequest(CamelModel):
    dpr_no: str | None = None
    dpr_date: date | None = None
    vessel_id: uuid.UUID | None = None
    vendor_id: uuid.UUID | None = None
    service_details: str | None = None
    amount_inr: Decimal | None = None
    fc_amount: Decimal | None = None
    currency: Currency | None = None
    payment_date: date | None = None
    payment_reference: str | None = None
    followup_status: FollowUpStatus | None = None
    last_known_remark: str | None = None
    reminder_1_sent_date: date | None = None
    reminder_2_sent_date: date | None = None
    final_invoice_received: bool | None = None
    po_number: str | None = None
    invoice_no: str | None = None
    invoice_date: date | None = None
    notes: str | None = None
