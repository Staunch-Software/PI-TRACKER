import { AuditAction, AuditEntityType, Currency, FollowUpStatus, UserRole } from './enums';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface Vessel {
  id: string;
  name: string;
  imoNumber: string | null;
  isActive: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  isActive: boolean;
}

// Mirrors all 23 columns of the "Follow-up Tracker" sheet, plus computed/audit fields.
export interface PiEntry {
  id: string;
  seqNo: number; // S.No.
  dprNo: string; // DPR No.
  dprDate: string | null;
  vesselId: string;
  vesselName: string; // joined for display
  vendorId: string;
  vendorName: string; // joined for display
  serviceDetails: string | null;
  amountInr: number | null;
  fcAmount: number | null;
  currency: Currency;
  paymentDate: string | null;
  paymentReference: string | null;
  daysSincePayment: number | null; // computed at query time, never stored
  // Wire field is "followupStatus" (no capital U) — Pydantic's to_camel on the backend's
  // followup_status produces this, since "followup" is one word, not "follow_up".
  followupStatus: FollowUpStatus;
  lastKnownRemark: string | null;
  reminder1SentDate: string | null;
  reminder2SentDate: string | null;
  finalInvoiceReceived: boolean;
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoiceFileName: string | null;
  attachedBy: string | null; // user id
  attachedByName: string | null; // joined for display
  dateAttached: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
  attachmentCount: number;
}

export interface InvoiceAttachment {
  id: string;
  piEntryId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  downloadUrl: string;
}

export interface AuditLogEntry {
  id: number;
  entityType: AuditEntityType;
  entityId: string;
  action: AuditAction;
  changedBy: string | null;
  changedByName: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  summary: string | null; // human-readable one-liner for the feed
  createdAt: string;
  isRead: boolean; // per-user: whether the current user has marked this read
  vesselId: string | null;
  vesselName: string | null;
}

export interface DashboardKpis {
  total: number;
  received: number;
  notFollowedUp: number;
  reminderSent: number;
  internalCheck: number;
  discrepancy: number;
  scheduled: number;
  other: number;
  notApplicable: number;
  overdue30Plus: number;
}

export interface OverdueEntry {
  id: string;
  dprNo: string;
  vesselName: string;
  vendorName: string;
  amountInr: number | string | null;
  currency: Currency;
  daysSincePayment: number;
  followupStatus: FollowUpStatus;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Import wizard: mirrors ImportRowData in backend/app/schemas/import_wizard.py.
export interface ImportRowData {
  rowNumber: number;
  dprNo: string | null;
  dprDate: string | null;
  vesselName: string | null;
  vendorName: string | null;
  serviceDetails: string | null;
  amountInr: number | string | null;
  fcAmount: number | string | null;
  currency: Currency;
  paymentDate: string | null;
  paymentReference: string | null;
  followupStatus: FollowUpStatus;
  lastKnownRemark: string | null;
  reminder1SentDate: string | null;
  reminder2SentDate: string | null;
  finalInvoiceReceived: boolean;
  invoiceNo: string | null;
  invoiceDate: string | null;
  notes: string | null;
}

export interface ImportRowPreview extends ImportRowData {
  errors: string[];
  isDuplicate: boolean;
  existingId: string | null;
  vesselExists: boolean;
  vendorExists: boolean;
}

export interface ImportParseResponse {
  rows: ImportRowPreview[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
}

export type ImportDecision = 'insert' | 'update' | 'skip';

export interface ImportCommitResponse {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}
