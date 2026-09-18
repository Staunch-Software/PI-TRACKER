import uuid
from datetime import datetime

from app.core.enums import Department
from app.schemas.base import CamelModel


class VendorMappingOut(CamelModel):
    id: uuid.UUID
    vendor_name: str
    department: Department
    active: bool
    created_at: datetime
    updated_at: datetime


class VendorMappingCreateRequest(CamelModel):
    vendor_name: str
    department: Department


class VendorMappingUpdateRequest(CamelModel):
    vendor_name: str | None = None
    department: Department | None = None
    active: bool | None = None


# ── Bulk import ──────────────────────────────────────────────────────────────────


class ColumnMappingCandidate(CamelModel):
    """One raw header found in the uploaded sheet, and the field we think it maps to (if any)."""

    raw_header: str
    column_index: int
    guessed_field: str | None = None  # "vendor_name" | "department" | None


class VendorImportRowPreview(CamelModel):
    row_number: int
    vendor_name: str | None = None
    department: Department | None = None
    errors: list[str] = []
    is_update: bool = False  # true if vendor_name_normalized already exists


class VendorImportParseResponse(CamelModel):
    needs_mapping: bool = False
    headers: list[ColumnMappingCandidate] = []
    rows: list[VendorImportRowPreview] = []
    total_rows: int = 0
    valid_rows: int = 0
    error_rows: int = 0


class VendorImportCommitRow(CamelModel):
    row_number: int
    vendor_name: str
    department: Department


class VendorImportCommitRequest(CamelModel):
    rows: list[VendorImportCommitRow]


class VendorImportRejectedRow(CamelModel):
    row_number: int
    reason: str


class VendorImportCommitResponse(CamelModel):
    inserted: int
    updated: int
    rejected: list[VendorImportRejectedRow]


# ── Health check ─────────────────────────────────────────────────────────────────
# Permanent fix for the "Manning vendor mapped but spelled slightly differently from what
# SmartPAL actually scraped" class of bug (e.g. "Manish travels" vs "Manish Travels & Tours") —
# matching itself stays strict exact-match (a fuzzy fallback here risks false Manning
# classifications across vendors that share common industry words like "marine"/"shipping"), so
# this surfaces mismatches for a human to review and fix, rather than silently misclassifying.


class VendorMappingHealthCandidate(CamelModel):
    """A real PIR vendor_name that looks similar to an unmatched mapping — a suggestion for a
    human to review, never auto-applied."""

    vendor_name: str
    invoice_count: int


class VendorMappingHealthIssue(CamelModel):
    mapping_id: uuid.UUID
    vendor_name: str
    department: Department
    candidates: list[VendorMappingHealthCandidate]


class VendorMappingHealthCheckOut(CamelModel):
    total_active_mappings: int
    unmatched_count: int
    issues: list[VendorMappingHealthIssue]
