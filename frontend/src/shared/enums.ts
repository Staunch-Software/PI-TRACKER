// Frontend's own copy of the enum values — single source of truth for the UI.
// Mirrored by hand in backend/app/core/enums.py; keep both in sync when changing values.

export enum UserRole {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

export enum Currency {
  INR = 'INR',
  USD = 'USD',
  EUR = 'EUR',
}

export enum FollowUpStatus {
  PENDING_NOT_YET_FOLLOWED_UP = 'PENDING_NOT_YET_FOLLOWED_UP',
  PENDING_REMINDER_SENT = 'PENDING_REMINDER_SENT',
  PENDING_INTERNAL_CHECK = 'PENDING_INTERNAL_CHECK',
  PENDING_DISCREPANCY_TO_RESOLVE = 'PENDING_DISCREPANCY_TO_RESOLVE',
  PENDING_SCHEDULED = 'PENDING_SCHEDULED',
  PENDING_OTHER = 'PENDING_OTHER',
  RECEIVED = 'RECEIVED',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
}

// Exact display strings as they appear in the source PI_Followup_Tracker.xlsx
// "Follow-up Status" dropdown (sheet: Follow-up Tracker!M5:M50 data validation).
// Used both for rendering in the UI and for matching values during Excel import.
export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  [FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP]: 'Pending - Not Yet Followed Up',
  [FollowUpStatus.PENDING_REMINDER_SENT]: 'Pending - Reminder Sent',
  [FollowUpStatus.PENDING_INTERNAL_CHECK]: 'Pending - Internal Check',
  [FollowUpStatus.PENDING_DISCREPANCY_TO_RESOLVE]: 'Pending - Discrepancy to Resolve',
  [FollowUpStatus.PENDING_SCHEDULED]: 'Pending - Scheduled',
  [FollowUpStatus.PENDING_OTHER]: 'Pending - Other',
  [FollowUpStatus.RECEIVED]: 'Received',
  [FollowUpStatus.NOT_APPLICABLE]: 'Not Applicable',
};

export const FOLLOW_UP_STATUS_LABEL_TO_ENUM: Record<string, FollowUpStatus> = Object.fromEntries(
  Object.entries(FOLLOW_UP_STATUS_LABELS).map(([enumValue, label]) => [label.toLowerCase(), enumValue as FollowUpStatus])
);

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  IMPORT = 'IMPORT',
  ATTACH = 'ATTACH',
  MARK_RECEIVED = 'MARK_RECEIVED',
}

export enum AuditEntityType {
  PI_ENTRY = 'pi_entry',
  USER = 'user',
  VESSEL = 'vessel',
  VENDOR = 'vendor',
  IMPORT_BATCH = 'import_batch',
}
