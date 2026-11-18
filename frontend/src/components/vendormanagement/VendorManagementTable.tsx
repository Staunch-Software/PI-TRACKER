import { useState } from 'react';
import type { VendorTrackerEntry } from '../../shared';
import { BANK_DETAILS_STATUS_LABELS, BankDetailsStatus } from '../../shared/enums';
import { formatSize, getFileKindInfo } from './VendorAttachmentsModal';

// The 3 vendor-level fields this module checks for completeness (Vendor Details column).
const VENDOR_DETAIL_FIELDS: Array<[keyof VendorTrackerEntry, string]> = [
  ['vendorEmail', 'Email'],
  ['vendorPhone1', 'Mobile'],
  ['vendorAddress', 'Address'],
];

// The 6 fields SmartPAL's own Bank Details tab is checked against (Bank Details Status column,
// via bankDetailsInPalMissingFields from the backend). There's no longer a separate manually-keyed
// copy of these — see VendorVerificationReminderModal/git history for why that was retired.
const BANK_FIELD_LABELS: string[] = ['Beneficiary Name', 'Bank Name', 'Branch Name', 'Account Number', 'IBAN', 'Swift Code'];

function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function DocumentsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function CheckShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// A row's present/missing state, rendered as a small check/cross chip — shared look for the
// Vendor Details and Bank Details Status columns' field checklists.
function FieldChecklist({ items }: { items: Array<{ label: string; value?: string | null; present: boolean }> }) {
  return (
    <div className="field-checklist">
      {items.map(({ label, value, present }) => (
        <div key={label} className={`field-checklist-row ${present ? 'is-present' : 'is-missing'}`}>
          <span className="field-checklist-icon">{present ? '✓' : '✕'}</span>
          <span className="field-checklist-label">{label}</span>
          {value && <span className="field-checklist-value" title={value}>{value}</span>}
        </div>
      ))}
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString();
}

interface Props {
  entries: VendorTrackerEntry[];
  page: number;
  pageSize: number;
  canEdit: boolean;

  isRefreshPending: boolean;
  onRefresh: (entry: VendorTrackerEntry) => void;

  isMarkReceivedPending: boolean;
  onMarkReceived: (entry: VendorTrackerEntry) => void;

  onSendBankRequest: (entry: VendorTrackerEntry) => void;
  onSendVerificationReminder: (entry: VendorTrackerEntry) => void;
  onOpenVerificationComplete: (entry: VendorTrackerEntry) => void;
  onOpenDocuments: (entry: VendorTrackerEntry) => void;

  emptyMessage: string;
}

// Shared table for both the "DD Vendors" and "All Vendors" tabs (VendorManagementPage.tsx) — same
// columns/actions either way, since the only difference between the two tabs is which rows are
// fetched (is_dd_vendor filter vs. the full SmartPAL master), not how a row behaves once it's on
// screen. A row from the "All Vendors" tab with no vendor_tracker_entries row yet still renders
// fully (every tracker-owned field just shows its untracked default) — clicking any action on it
// transparently materializes the row first (see VendorManagementPage.tsx's ensureTrackingId).
export function VendorManagementTable({
  entries,
  page,
  pageSize,
  canEdit,
  isRefreshPending,
  onRefresh,
  isMarkReceivedPending,
  onMarkReceived,
  onSendBankRequest,
  onSendVerificationReminder,
  onOpenVerificationComplete,
  onOpenDocuments,
  emptyMessage,
}: Props) {
  const [expandedDocRows, setExpandedDocRows] = useState<Record<string, boolean>>({});

  function toggleDocsExpanded(id: string) {
    setExpandedDocRows((prev) => ({ ...prev, [id]: !prev[id] }));
  }
  return (
    <div className="tracker-table-shell vendor-management-table-shell">
      <table className="data-table vendor-management-table">
        <thead>
          <tr>
            <th className="col-sno">S.No</th>
            <th className="col-vendor">Vendor</th>
            <th className="col-vendor-details" title="Email, Mobile, and Address, read live from SmartPAL's vendor master.">Vendor Details</th>
            <th className="col-bank-status" title="The 6 mandatory bank fields, read live from SmartPAL's own Bank Details tab.">Bank Details Status</th>
            <th className="col-verified-bank" title="Notify Accounts Payable to verify the bank details SmartPAL has on file for this vendor.">
              Verification Reminder
            </th>
            <th className="col-center col-verification">Bank Verification</th>
            <th className="col-docs" title="SmartPAL scraped master documents and verified bank reply attachments">Full Documents</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-state">{emptyMessage}</td>
            </tr>
          )}
          {entries.map((entry, idx) => {
            const rowNumber = (page - 1) * pageSize + idx + 1;
            const palMissing = entry.bankDetailsInPalMissingFields ?? [];
            const palComplete = entry.bankDetailsInPalComplete;

            return (
              <tr key={entry.id ?? entry.vendorCode}>
                <td className="col-sno">
                  <span className="vendor-sno-pill">{rowNumber}</span>
                </td>
                <td className="col-vendor">
                  <div className="vendor-name-text">{entry.vendorName ?? entry.vendorCode}</div>
                  <div className="vendor-code-badge">{entry.vendorCode}</div>
                </td>
                <td className="col-vendor-details">
                  {entry.detailScrapePending ? (
                    <span className="vendor-badge vendor-badge-pending">Refreshing…</span>
                  ) : (
                    <FieldChecklist
                      items={VENDOR_DETAIL_FIELDS.map(([key, label]) => ({
                        label,
                        value: entry[key] ? String(entry[key]) : null,
                        present: !!entry[key],
                      }))}
                    />
                  )}
                  {canEdit && !entry.detailScrapePending && (
                    <button
                      className="vendor-refresh-btn"
                      title="Refresh from SmartPAL"
                      onClick={() => onRefresh(entry)}
                      disabled={isRefreshPending}
                    >
                      <RefreshIcon />
                      <span>{isRefreshPending ? 'Refreshing…' : 'Refresh'}</span>
                    </button>
                  )}
                </td>
                <td className="col-bank-status">
                  <div style={{ marginBottom: 6 }}>
                    {palComplete ? (
                      // Confirmed 2026-11-04: the stored bank_details_status only ever advances
                      // via the request/receive workflow (missing -> requested -> received) — a
                      // vendor whose bank details were already complete in SmartPAL from the start
                      // never goes through that workflow at all, so the badge would otherwise say
                      // "Missing" forever even with every field present below it. Once SmartPAL's
                      // own data is complete, that's what actually matters — show that instead of
                      // the stale workflow status.
                      <span className="vendor-badge vendor-badge-ok">Complete</span>
                    ) : (
                      <span className={`vendor-badge vendor-badge-status-${entry.bankDetailsStatus}`}>
                        {BANK_DETAILS_STATUS_LABELS[entry.bankDetailsStatus as BankDetailsStatus] ?? entry.bankDetailsStatus}
                      </span>
                    )}
                  </div>
                  <FieldChecklist items={BANK_FIELD_LABELS.map((label) => ({ label, present: !palMissing.includes(label) }))} />
                  {canEdit && !palComplete && (
                    <div className="vendor-action-buttons">
                      <button
                        className="vendor-table-btn vendor-btn-request"
                        onClick={() => onSendBankRequest(entry)}
                        title={entry.bankDetailsStatus === BankDetailsStatus.MISSING ? 'Send official bank details request email' : 'Re-send bank request email'}
                      >
                        <MailIcon />
                        <span>{entry.bankDetailsStatus === BankDetailsStatus.MISSING ? 'Send Bank Details Request' : 'Re-send Bank Request'}</span>
                      </button>
                      {(entry.bankDetailsStatus === BankDetailsStatus.MISSING || entry.bankDetailsStatus === BankDetailsStatus.REQUESTED) && (
                        <button
                          className="vendor-table-btn vendor-btn-secondary"
                          disabled={isMarkReceivedPending}
                          onClick={() => onMarkReceived(entry)}
                        >
                          Mark Received
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="col-verified-bank">
                  {canEdit && (
                    <button
                      className="vendor-table-btn vendor-btn-request"
                      disabled={!palComplete}
                      title={!palComplete ? `All mandatory bank fields must be present in SmartPAL first (missing: ${palMissing.join(', ')})` : 'Ask Accounts Payable to verify these bank details'}
                      onClick={() => onSendVerificationReminder(entry)}
                    >
                      <BellIcon />
                      <span>Send Verification Reminder</span>
                    </button>
                  )}
                </td>
                <td className="col-center col-verification">
                  <div className="vendor-verification-cell">
                    {entry.bankVerificationCompleted ? (
                      <div className="vendor-verified-badge">
                        <CheckShieldIcon />
                        <div className="vendor-verified-badge-text">
                          <span className="vendor-verified-title">Verified</span>
                          {entry.bankVerificationCompletedByName && (
                            <span className="vendor-verified-by">{entry.bankVerificationCompletedByName}</span>
                          )}
                        </div>
                      </div>
                    ) : canEdit ? (
                      <button
                        className="vendor-table-btn vendor-btn-verify"
                        disabled={!palComplete}
                        title={!palComplete ? `All mandatory bank fields must be present in SmartPAL first (missing: ${palMissing.join(', ')})` : undefined}
                        onClick={() => onOpenVerificationComplete(entry)}
                      >
                        <CheckShieldIcon />
                        <span>Verification Complete</span>
                      </button>
                    ) : (
                      <span className="vendor-badge vendor-badge-warn">Not verified</span>
                    )}
                    {entry.bankVerificationCompletedAt && (
                      <div className="vendor-verified-date">
                        <CalendarIcon />
                        <span>{formatDate(entry.bankVerificationCompletedAt)}</span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="col-docs">
                  <div className="vendor-table-docs-cell">
                    {entry.attachments && entry.attachments.length > 0 ? (
                      <>
                        <div className="vendor-table-docs-header">
                          <span
                            className="vendor-table-docs-count-badge"
                            title={`${entry.attachments.length} attached documents`}
                          >
                            <DocumentsIcon />
                            <span>
                              {entry.attachments.length}{' '}
                              {entry.attachments.length === 1 ? 'Doc' : 'Docs'}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="vendor-table-docs-manage-link"
                            title="Open full documents modal to preview, manage or upload attachments"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDocuments(entry);
                            }}
                          >
                            <span>Manage / Add</span>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                        </div>

                        {(() => {
                          const rowKey = entry.id ?? entry.vendorCode;
                          const isExpanded = !!expandedDocRows[rowKey];
                          const DEFAULT_LIMIT = 7;
                          const hasMore = entry.attachments.length > DEFAULT_LIMIT;
                          const visibleAtts =
                            isExpanded || !hasMore
                              ? entry.attachments
                              : entry.attachments.slice(0, DEFAULT_LIMIT);
                          const remainingCount = entry.attachments.length - DEFAULT_LIMIT;

                          return (
                            <>
                              <div
                                className={`vendor-table-docs-list ${
                                  isExpanded ? 'is-expanded' : ''
                                }`}
                              >
                                {visibleAtts.map((att) => {
                                  const kind = getFileKindInfo(
                                    att.fileName,
                                    att.contentType ?? undefined
                                  );
                                  return (
                                    <a
                                      key={att.id}
                                      href={att.downloadUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="vendor-table-doc-link"
                                      title={`${att.fileName} (${formatSize(
                                        att.sizeBytes
                                      )}) • Click to open/download`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <span
                                        className="vendor-doc-mini-badge"
                                        style={{
                                          color: kind.color,
                                          background: kind.bg,
                                          borderColor: kind.border,
                                        }}
                                      >
                                        {kind.label}
                                      </span>
                                      <span className="vendor-table-doc-name">
                                        {att.fileName}
                                      </span>
                                      <span className="vendor-table-doc-size">
                                        {formatSize(att.sizeBytes)}
                                      </span>
                                      <svg
                                        className="vendor-table-doc-arrow"
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                    </a>
                                  );
                                })}
                              </div>

                              {hasMore && (
                                <button
                                  type="button"
                                  className="vendor-docs-toggle-expand-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDocsExpanded(rowKey);
                                  }}
                                  title={
                                    isExpanded
                                      ? 'Collapse documents list'
                                      : `Show all ${entry.attachments.length} documents`
                                  }
                                >
                                  {isExpanded ? (
                                    <>
                                      <span>Show less</span>
                                      <span className="expand-arrow">▲</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>+{remainingCount} more documents</span>
                                      <span className="expand-arrow">▼</span>
                                    </>
                                  )}
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      <div className="vendor-table-docs-empty-box">
                        <span className="vendor-table-docs-empty-text">
                          No documents
                        </span>
                        <button
                          type="button"
                          className="vendor-docs-add-first-btn"
                          title="Open modal to upload attachments"
                          onClick={() => onOpenDocuments(entry)}
                        >
                          <DocumentsIcon />
                          <span>+ Add / Manage</span>
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
