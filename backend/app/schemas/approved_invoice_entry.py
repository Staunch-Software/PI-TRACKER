import uuid
from datetime import date, datetime
from decimal import Decimal

from app.core.enums import PaymentStatus
from app.schemas.base import CamelModel


class ApprovedInvoiceEntryOut(CamelModel):
    id: uuid.UUID
    smartpal_invoice_id: int
    invoice_no: str | None
    vendor_invoice_no: str | None
    vendor_name: str | None
    vessel_name: str | None
    vessel_id: uuid.UUID | None
    amount: Decimal | None
    currency_code: str | None
    po_nos: str | None
    category_name: str | None
    status: str | None
    invoice_date: date | None
    forward_date: datetime | None
    attachment: bool | None
    grn_exists: bool | None
    payment_status: PaymentStatus
    first_scraped_at: datetime
    last_scraped_at: datetime


class UpdatePaymentStatusRequest(CamelModel):
    payment_status: PaymentStatus
