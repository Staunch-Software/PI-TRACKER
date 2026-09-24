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
  // Not part of the original spreadsheet's dropdown — a user-requested addition so "Add New PI"
  // can be picked directly from the per-row Follow-up Status dropdown while adding/editing an
  // entry. Deliberately excluded from the Tracker toolbar's status filter (see STATUS_OPTIONS in
  // TrackerPage.tsx), since it isn't meaningful to filter by.
  ADD_NEW_PI = 'ADD_NEW_PI',
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
  [FollowUpStatus.ADD_NEW_PI]: 'New PI',
};

export const FOLLOW_UP_STATUS_LABEL_TO_ENUM: Record<string, FollowUpStatus> = Object.fromEntries(
  Object.entries(FOLLOW_UP_STATUS_LABELS).map(([enumValue, label]) => [label.toLowerCase(), enumValue as FollowUpStatus])
);

export enum PaymentStatus {
  PAID = 'PAID',
  NOT_PAID = 'NOT_PAID',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.PAID]: 'Paid',
  [PaymentStatus.NOT_PAID]: 'Not Paid',
};

export enum Department {
  TECHNICAL = 'TECHNICAL',
  MANNING = 'MANNING',
}

// Exact display strings for the Department dropdown / table column.
export const DEPARTMENT_LABELS: Record<Department, string> = {
  [Department.TECHNICAL]: 'Technical',
  [Department.MANNING]: 'Manning',
};

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  IMPORT = 'IMPORT',
  ATTACH = 'ATTACH',
  MARK_RECEIVED = 'MARK_RECEIVED',
  SENT_VENDOR_NOTICE = 'SENT_VENDOR_NOTICE',
  SENT_OWNER_REMINDER = 'SENT_OWNER_REMINDER',
}

export enum AuditEntityType {
  PI_ENTRY = 'pi_entry',
  USER = 'user',
  VESSEL = 'vessel',
  VENDOR = 'vendor',
  IMPORT_BATCH = 'import_batch',
  APPROVED_INVOICE_ENTRY = 'approved_invoice_entry',
  VENDOR_MAPPING = 'vendor_mapping',
  VENDOR_MAPPING_IMPORT_BATCH = 'vendor_mapping_import_batch',
  PIR_ENTRY = 'pir_entry',
  OWNER_RECIPIENT = 'owner_recipient',
}

// Where a SOA line item's invoice currently lives, in priority order.
export enum SoaMatchSource {
  SMARTPAL = 'SMARTPAL',
  PIR = 'PIR',
  INVOICE_MAIL = 'INVOICE_MAIL',
  NONE = 'NONE',
}

export const SOA_MATCH_SOURCE_LABELS: Record<SoaMatchSource, string> = {
  [SoaMatchSource.SMARTPAL]: 'SmartPAL',
  [SoaMatchSource.PIR]: 'PIR',
  [SoaMatchSource.INVOICE_MAIL]: 'Invoice Mail Only',
  [SoaMatchSource.NONE]: 'No Match',
};
