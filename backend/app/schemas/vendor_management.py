import uuid
from datetime import datetime

from pydantic import EmailStr, Field

from app.schemas.base import CamelModel

_TEXT_MAX = 500


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
    # Nullable: an "All Vendors" tab row for a vendor with no vendor_tracker_entries row yet has
    # no id — every row action lazily creates one via ensure-tracking on first use (see
    # api/routes/vendor_management.py). A "DD Vendors" tab row always has a real id.
    id: uuid.UUID | None = None
    seq_no: int | None = None
    vendor_code: str
    is_dd_vendor: bool = False

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

    # Null for an id-less "All Vendors" row with no tracker entry yet, same reasoning as id above.
    created_at: datetime | None = None
    updated_at: datetime | None = None

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
    # Whether the vendor's representative (default, else first) SmartPAL bank row has all 6
    # mandatory fields filled — drives the "Verification Complete" gate (see
    # api/routes/vendor_management.py's mark_verification_completed) and the Bank Details Status
    # column's own field checklist. Separate from has_mandatory_details (vendor-level
    # email/phone/address) and from the manually-keyed bank_* fields above.
    bank_details_in_pal_complete: bool = False
    bank_details_in_pal_missing_fields: list[str] = []


class VendorBankRequestPreview(CamelModel):
    """Editable draft shown in the "Send Bank Details Request" preview modal before it's sent."""

    to_email: str
    cc_emails: list[str] = []
    subject: str
    body: str


class VendorBankRequestSend(CamelModel):
    to: list[EmailStr] = Field(min_length=1)
    cc: list[EmailStr] = []
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    from_mailbox: str = Field(min_length=1, max_length=320)


class VendorVerificationReminderPreview(CamelModel):
    """Editable draft shown in the "Send Verification Reminder" preview modal before it's sent."""

    to_email: str
    cc_emails: list[str] = []
    subject: str
    body: str


class VendorVerificationReminderSend(CamelModel):
    to: list[EmailStr] = Field(min_length=1)
    cc: list[EmailStr] = []
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)


class VendorTrackerEntryDetailOut(CamelModel):
    """Full detail view for a single tracked vendor — the live Vendor Contacts sub-grid and the
    live SmartPAL Bank Details rows, read-only, separate from the editable override fields."""

    contacts: list[dict] = []
    bank_details: list[VendorBankDetailOut] = []
