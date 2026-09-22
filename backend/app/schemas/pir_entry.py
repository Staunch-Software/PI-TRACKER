import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelModel

PirDepartment = Literal["TECHNICAL", "MANNING", "UNCLASSIFIED"]


class PirEntryOut(CamelModel):
    id: uuid.UUID
    smartpal_invoice_id: int
    document_id: int | None
    invoice_no: str | None
    reg_invoice_no: str | None
    vendor_invoice_no: str | None
    vendor_name: str | None
    vessel_name: str | None
    company_name: str | None
    vendor_bank_name: str | None
    vendor_account_code: str | None
    vendor_swift_code: str | None
    reg_date: date | None
    frwd_from: str | None
    amount: Decimal | None
    status: str | None
    po_nos: str | None
    currency_code: str | None
    total_datapoints: int | None
    available_data_points: int | None
    modified_from_pal: bool | None
    reject_remark: str | None
    # Computed at query time (see api/routes/pir_entries.py _CLASSIFIED_CTE) — not a stored
    # column. See app/models/pir_entry.py docstring for the Manning-allowlist / Technical-default
    # classification policy.
    department: PirDepartment
    # Computed at query time via services/pir_vessel_matcher.py — the canonical vessels-table
    # name this row's raw vessel_name matches (or the manually assigned vessel, which always
    # wins — see resolve_vessel_group), or one of the two catch-all groups (see that module for
    # why "not in fleet" and "ambiguous/multiple" both collapse to the same bucket).
    vessel_group: str
    assigned_vessel_id: uuid.UUID | None
    # (CURRENT_DATE - reg_date) — computed in SQL, same "computed live, not stored" convention as
    # pi_entries.days_since_payment. Null when reg_date itself is null.
    age_days: int | None
    first_scraped_at: datetime
    last_scraped_at: datetime
    # Set once this invoice disappears from a live SmartPAL sweep (resolved/pushed to normal
    # invoice processing) — see app/models/pir_entry.py docstring. Null while still open.
    resolved_at: datetime | None


class PirDepartmentCounts(CamelModel):
    # "all" collides with the Python builtin — explicit Field alias overrides CamelModel's
    # auto-generated one so this still comes over the wire as plain "all".
    all_: int = Field(alias="all")
    technical: int
    manning: int
    unclassified: int


class PirOldestInvoiceOut(CamelModel):
    id: uuid.UUID
    invoice_no: str | None
    vendor_name: str | None
    vessel_group: str
    age_days: int


class PirCurrencyMixEntryOut(CamelModel):
    currency_code: str
    count: int
    percentage: float


class PirKpisOut(CamelModel):
    total_open: int
    by_department: PirDepartmentCounts
    needs_triage_count: int
    oldest_invoice: PirOldestInvoiceOut | None
    currency_mix: list[PirCurrencyMixEntryOut]


class AssignVesselRequest(CamelModel):
    vessel_id: uuid.UUID | None  # null clears the manual assignment, falling back to auto-matching
