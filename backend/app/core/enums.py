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
