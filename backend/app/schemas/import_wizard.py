import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from app.core.enums import Currency, FollowUpStatus
from app.schemas.base import CamelModel


class ImportRowData(CamelModel):
    row_number: int
    dpr_no: str | None = None
    dpr_date: date | None = None
    vessel_name: str | None = None
    vendor_name: str | None = None
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
    invoice_no: str | None = None
    invoice_date: date | None = None
    notes: str | None = None


class ImportRowPreview(ImportRowData):
    errors: list[str] = []
    is_duplicate: bool = False
    existing_id: uuid.UUID | None = None
    vessel_exists: bool = False
    vendor_exists: bool = False


class ImportParseResponse(CamelModel):
    rows: list[ImportRowPreview]
    total_rows: int
    valid_rows: int
    error_rows: int
    duplicate_rows: int


class ImportCommitRow(ImportRowData):
    decision: Literal["insert", "update", "skip"]
    existing_id: uuid.UUID | None = None


class ImportCommitRequest(CamelModel):
    rows: list[ImportCommitRow]


class ImportCommitResponse(CamelModel):
    inserted: int
    updated: int
    skipped: int
    failed: int
    errors: list[str]
