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
    "supply_port",
    "remarks",
    "invoice_type",
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
    readiness_date: date | None = None
    ex_stock: str | None = Field(default=None, max_length=_TEXT_MAX)
    supply_confirmation: str | None = Field(default=None, max_length=_TEXT_MAX)
    supply_port: str | None = Field(default=None, max_length=_TEXT_MAX)
    remarks: str | None = Field(default=None, max_length=_TEXT_MAX)
    invoice_type: str | None = Field(default=None, max_length=_TEXT_MAX)


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
    readiness_date: date | None
    ex_stock: str | None
    supply_confirmation: str | None
    remarks: str | None
    invoice_type: str | None

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
    po_confirmed_date: date | None = None  # "PO Acknowledged date" — sourced from po.approved_date, see dd_tracker.py
    po_schd_del_port: str | None = None  # "Supply Port"
    po_agent_name: str | None = None
    po_warehouse_name: str | None = None
    po_grn_nos: str | None = None
    po_do_nos: str | None = None

    # ── Live-joined from smartpal_invoice_entries (matched by its po_nos field against this
    # row's po_no) — see api/routes/dd_tracker.py and dd_tracker_entry.py docstring. None when no
    # invoice has been raised against this PO yet. A PO with more than one invoice (partial
    # invoicing) surfaces the most recently scraped one.
    invoice_number: str | None = None
    invoice_amount: Decimal | None = None
    invoice_currency: str | None = None
    invoice_status: str | None = None
    # "PAID" or "Not Paid" — derived from smartpal_invoice_entries.paid_status (see
    # api/routes/dd_tracker.py); None when no invoice has been raised against this PO yet.
    payment_status: str | None = None

    # Computed, never stored — (readiness_date - po_confirmed_date), the vendor's actual lead
    # time. None whenever either date is missing (readiness not yet set, or PO not yet
    # acknowledged) — see api/routes/dd_tracker.py.
    lead_days: int | None = None


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


class DdTrackerBulkDeleteRequest(CamelModel):
    ids: list[uuid.UUID] = Field(min_length=1)


class DdTrackerBulkDeleteResult(CamelModel):
    deleted_count: int


class PoItemDetailOut(CamelModel):
    id: uuid.UUID
    po_no: str
    vessel_name: str | None = None
    item_type: str = "ITEM"
    account_code: str | None = None
    account_code_desc: str | None = None
    part_number: str | None = None
    item_description: str | None = None
    rob: Decimal | None = None
    unit_price: Decimal | None = None
    quantity: Decimal | None = None
    discount_pct: Decimal | None = None
    total_amount_inr: Decimal | None = None
    total_amount_usd: Decimal | None = None
    vat_key: str | None = None
    vat_pct: Decimal | None = None
    sub_account_code: str | None = None
    analysis_code: str | None = None
    client_code: str | None = None
    drawing_no: str | None = None
    scraped_at: datetime


class AccountCodeSpendForPo(CamelModel):
    account_code: str
    account_code_desc: str | None = None
    total_spend_inr: Decimal = Decimal(0)
    total_spend_usd: Decimal = Decimal(0)
    item_count: int = 0
    items: list[PoItemDetailOut] = []


class PoAccountGroup(CamelModel):
    po_no: str
    vessel_name: str | None = None
    po_title: str | None = None
    vendor: str | None = None
    currency: str | None = None
    po_base_amount: Decimal | None = None
    total_spend_inr: Decimal = Decimal(0)
    total_spend_usd: Decimal = Decimal(0)
    total_account_codes: int = 0
    total_items: int = 0
    account_codes: list[AccountCodeSpendForPo] = []


class PoSpendForAccountCode(CamelModel):
    po_no: str
    vessel_name: str | None = None
    po_title: str | None = None
    vendor: str | None = None
    currency: str | None = None
    po_base_amount: Decimal | None = None
    total_spend_inr: Decimal = Decimal(0)
    total_spend_usd: Decimal = Decimal(0)
    item_count: int = 0
    items: list[PoItemDetailOut] = []


class AccountCodeGroup(CamelModel):
    account_code: str
    account_code_desc: str | None = None
    total_spend_inr: Decimal = Decimal(0)
    total_spend_usd: Decimal = Decimal(0)
    total_pos: int = 0
    total_items: int = 0
    pos: list[PoSpendForAccountCode] = []


class AccountCodeAnalysisResponse(CamelModel):
    account_codes: list[AccountCodeGroup] = []
    pos: list[PoAccountGroup] = []
    total_pos: int = 0
    total_vessels: int = 0
    total_account_codes: int = 0
    total_items: int = 0
    grand_total_spend_inr: Decimal = Decimal(0)
    grand_total_spend_usd: Decimal = Decimal(0)
    vessel_options: list[str] = []
    account_code_options: list[str] = []


class SyncPoItemsRequest(CamelModel):
    po_nos: list[str] | None = None
    force: bool = False


class SyncPoItemsResponse(CamelModel):
    scraped_pos: int
    items: int
    add_amounts: int
    errors: int
    message: str | None = None

