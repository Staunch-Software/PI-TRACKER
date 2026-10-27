import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import Field, field_validator

from app.schemas.base import CamelModel

_TEXT_MAX = 500

_MANUAL_TEXT_FIELDS = (
    "entry_type",
    "requisition_no",
    "po_no",
    "vessel_name",
    "title",
    "pr_status",
    "order_status",
    "ex_stock",
    "supply_confirmation",
    "remarks_1",
    "remarks_2",
    "invoice_number",
    "invoice_type",
    "invoice_currency",
    "payment_status",
)


class _TextFieldsMixin(CamelModel):
    # Blank/whitespace-only text is stored as NULL, same convention as LandingReport.
    @field_validator(*_MANUAL_TEXT_FIELDS, mode="before", check_fields=False)
    @classmethod
    def _strip_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class DdTrackerEntryCreate(_TextFieldsMixin):
    entry_type: str | None = Field(default=None, max_length=_TEXT_MAX)
    requisition_no: str | None = Field(default=None, max_length=_TEXT_MAX)
    po_no: str | None = Field(default=None, max_length=_TEXT_MAX)
    vessel_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    title: str | None = Field(default=None, max_length=_TEXT_MAX)
    pr_status: str | None = Field(default=None, max_length=_TEXT_MAX)
    order_status: str | None = Field(default=None, max_length=_TEXT_MAX)
    lead_days: int | None = None
    readiness_date: date | None = None
    ex_stock: str | None = Field(default=None, max_length=_TEXT_MAX)
    supply_confirmation: str | None = Field(default=None, max_length=_TEXT_MAX)
    remarks_1: str | None = Field(default=None, max_length=_TEXT_MAX)
    remarks_2: str | None = Field(default=None, max_length=_TEXT_MAX)
    invoice_number: str | None = Field(default=None, max_length=_TEXT_MAX)
    invoice_type: str | None = Field(default=None, max_length=_TEXT_MAX)
    invoice_amount: Decimal | None = None
    invoice_currency: str | None = Field(default=None, max_length=_TEXT_MAX)
    payment_status: str | None = Field(default=None, max_length=_TEXT_MAX)


class DdTrackerEntryUpdate(DdTrackerEntryCreate):
    pass


class DdTrackerEntryOut(CamelModel):
    id: uuid.UUID
    seq_no: int

    entry_type: str | None
    requisition_no: str | None
    po_no: str | None
    vessel_name: str | None
    title: str | None

    pr_status: str | None
    order_status: str | None
    lead_days: int | None
    readiness_date: date | None
    ex_stock: str | None
    supply_confirmation: str | None
    remarks_1: str | None
    remarks_2: str | None
    invoice_number: str | None
    invoice_type: str | None
    invoice_amount: Decimal | None
    invoice_currency: str | None
    payment_status: str | None

    created_at: datetime
    updated_at: datetime

    # ── Live-joined fields from pr_entries / po_entries (see api/routes/dd_tracker.py) — never
    # stored on this row, always read fresh so a PR/PO status change shows up immediately. None
    # when the linked requisition_no/po_no has no match (not yet scraped, or typo'd).
    pr_title: str | None = None
    pr_status_live: str | None = None
    pr_department: str | None = None
    pr_req_category: str | None = None

    po_title: str | None = None
    po_vendor: str | None = None
    po_req_category: str | None = None
    po_approved_status: str | None = None
    po_invoice_status: str | None = None
    po_base_amount: Decimal | None = None
    po_base_currency: str | None = None
    po_confirmed_date: date | None = None  # "PO Acknowledged date"
    po_schd_del_port: str | None = None  # "Supply Port"
    po_agent_name: str | None = None
    po_warehouse_name: str | None = None
    po_grn_nos: str | None = None
    po_do_nos: str | None = None


class PrLookupResult(CamelModel):
    requisition_no: str
    title: str | None
    vessel_name: str | None
    req_category: str | None
    status: str | None


class PoLookupResult(CamelModel):
    po_no: str
    title: str | None
    vessel_name: str | None
    vendor: str | None
    req_category: str | None
    approved_status: str | None
