import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.base import CamelModel

_TEXT_MAX = 500

_MANUAL_TEXT_FIELDS = (
    "bank_beneficiary_name",
    "bank_name",
    "bank_branch_name",
    "bank_account_number",
    "bank_iban",
    "bank_swift_code",
)


class _TextFieldsMixin(CamelModel):
    # Blank/whitespace-only text is stored as NULL, same convention as DdTrackerEntry.
    @field_validator(*_MANUAL_TEXT_FIELDS, mode="before", check_fields=False)
    @classmethod
    def _strip_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class VendorMasterLookupResult(CamelModel):
    vendor_code: str
    vendor_name: str | None
    vendor_type: str | None
    email: str | None
    currency: str | None
    city: str | None
    country: str | None
    state: str | None


class VendorTrackerEntryCreate(CamelModel):
    vendor_code: str = Field(min_length=1, max_length=_TEXT_MAX)


class VendorTrackerEntryBankUpdate(_TextFieldsMixin):
    bank_beneficiary_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    bank_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    bank_branch_name: str | None = Field(default=None, max_length=_TEXT_MAX)
    bank_account_number: str | None = Field(default=None, max_length=_TEXT_MAX)
    bank_iban: str | None = Field(default=None, max_length=_TEXT_MAX)
    bank_swift_code: str | None = Field(default=None, max_length=_TEXT_MAX)


class VendorBankDetailOut(CamelModel):
    id: uuid.UUID
    beneficiary_name: str | None
    branch_name: str | None
    bank_name: str | None
    country: str | None
    bank_code: str | None
    currency: str | None
    account_number: str | None
    iban: str | None
    swift_code: str | None
    aba_no: str | None
    is_default: bool
    is_active: bool


class VendorTrackerEntryOut(CamelModel):
    id: uuid.UUID
    seq_no: int
    vendor_code: str

    bank_details_status: str
    bank_request_sent_at: datetime | None
    bank_request_sent_by_name: str | None = None
    bank_details_received_at: datetime | None
    bank_details_received_by_name: str | None = None
    bank_details_updated_at: datetime | None
    bank_details_updated_by_name: str | None = None

    bank_beneficiary_name: str | None
    bank_name: str | None
    bank_branch_name: str | None
    bank_account_number: str | None
    bank_iban: str | None
    bank_swift_code: str | None

    bank_verification_completed: bool
    bank_verification_completed_by_name: str | None = None
    bank_verification_completed_at: datetime | None

    created_at: datetime
    updated_at: datetime

    # ── Live-joined from vendor_master_entries by vendor_code (see api/routes/vendor_management.py)
    # — never stored on this row. None when the detail scrape hasn't completed yet (see
    # detail_scrape_pending) or the vendor was removed from SmartPAL.
    vendor_name: str | None = None
    vendor_type: str | None = None
    vendor_email: str | None = None
    vendor_phone_1: str | None = None
    vendor_address: str | None = None
    vendor_city: str | None = None
    vendor_country: str | None = None
    vendor_state: str | None = None

    # True while the vendor's on-demand detail scrape (contacts/bank/attachments) hasn't completed
    # yet — drives the frontend's "Refreshing from SmartPAL…" state.
    detail_scrape_pending: bool = True
    # Email + Address + Phone 1 all present — the three mandatory "Vendor Details" fields.
    has_mandatory_details: bool = False
    # Count of live vendor_bank_details rows scraped from SmartPAL for this vendor (separate from
    # the manually-keyed bank_* override fields above).
    bank_details_count: int = 0


class VendorTrackerEntryDetailOut(CamelModel):
    """Full detail view for a single tracked vendor — the live Vendor Contacts sub-grid and the
    live SmartPAL Bank Details rows, read-only, separate from the editable override fields."""

    contacts: list[dict] = []
    bank_details: list[VendorBankDetailOut] = []
