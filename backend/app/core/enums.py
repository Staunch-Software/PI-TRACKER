# Python mirror of the enum values in frontend/src/shared/enums.ts — keep both in sync by hand.
import enum


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    EDITOR = "EDITOR"
    VIEWER = "VIEWER"


class Currency(str, enum.Enum):
    INR = "INR"
    USD = "USD"
    EUR = "EUR"


class FollowUpStatus(str, enum.Enum):
    PENDING_NOT_YET_FOLLOWED_UP = "PENDING_NOT_YET_FOLLOWED_UP"
    PENDING_REMINDER_SENT = "PENDING_REMINDER_SENT"
    PENDING_INTERNAL_CHECK = "PENDING_INTERNAL_CHECK"
    PENDING_DISCREPANCY_TO_RESOLVE = "PENDING_DISCREPANCY_TO_RESOLVE"
    PENDING_SCHEDULED = "PENDING_SCHEDULED"
    PENDING_OTHER = "PENDING_OTHER"
    RECEIVED = "RECEIVED"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    # Not part of the original spreadsheet's dropdown — a user-requested addition so "Add New PI"
    # can be picked directly from the per-row Follow-up Status dropdown while adding/editing an
    # entry. Deliberately excluded from the Tracker toolbar's status filter (see STATUS_OPTIONS in
    # frontend/src/pages/TrackerPage.tsx), since it isn't meaningful to filter by.
    ADD_NEW_PI = "ADD_NEW_PI"


# Exact display strings as they appear in the source PI_Followup_Tracker.xlsx dropdown.
FOLLOW_UP_STATUS_LABELS: dict[FollowUpStatus, str] = {
    FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP: "Pending - Not Yet Followed Up",
    FollowUpStatus.PENDING_REMINDER_SENT: "Pending - Reminder Sent",
    FollowUpStatus.PENDING_INTERNAL_CHECK: "Pending - Internal Check",
    FollowUpStatus.PENDING_DISCREPANCY_TO_RESOLVE: "Pending - Discrepancy to Resolve",
    FollowUpStatus.PENDING_SCHEDULED: "Pending - Scheduled",
    FollowUpStatus.PENDING_OTHER: "Pending - Other",
    FollowUpStatus.RECEIVED: "Received",
    FollowUpStatus.NOT_APPLICABLE: "Not Applicable",
    FollowUpStatus.ADD_NEW_PI: "New PI",
}


class PaymentStatus(str, enum.Enum):
    PAID = "PAID"
    NOT_PAID = "NOT_PAID"


class Department(str, enum.Enum):
    TECHNICAL = "TECHNICAL"
    MANNING = "MANNING"


# Exact display strings for the Department dropdown / table column.
DEPARTMENT_LABELS: dict[Department, str] = {
    Department.TECHNICAL: "Technical",
    Department.MANNING: "Manning",
}


class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    IMPORT = "IMPORT"
    ATTACH = "ATTACH"
    MARK_RECEIVED = "MARK_RECEIVED"


class AuditEntityType(str, enum.Enum):
    PI_ENTRY = "pi_entry"
    USER = "user"
    VESSEL = "vessel"
    VENDOR = "vendor"
    IMPORT_BATCH = "import_batch"
    APPROVED_INVOICE_ENTRY = "approved_invoice_entry"
    VENDOR_MAPPING = "vendor_mapping"
    VENDOR_MAPPING_IMPORT_BATCH = "vendor_mapping_import_batch"
    PIR_ENTRY = "pir_entry"


# Where a SOA line item's invoice currently lives, in priority order — see
# soa_line_item.py docstring for why this is checked in this order.
class SoaMatchSource(str, enum.Enum):
    SMARTPAL = "SMARTPAL"
    PIR = "PIR"
    INVOICE_MAIL = "INVOICE_MAIL"
    NONE = "NONE"


SOA_MATCH_SOURCE_LABELS: dict[SoaMatchSource, str] = {
    SoaMatchSource.SMARTPAL: "SmartPAL",
    SoaMatchSource.PIR: "PIR",
    SoaMatchSource.INVOICE_MAIL: "Invoice Mail Only",
    SoaMatchSource.NONE: "No Match",
}
