import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../auth/useRole';
import { api, ApiError } from '../../lib/api';
import { BANK_DETAILS_STATUS_LABELS, BankDetailsStatus } from '../../shared/enums';
import type {
  PaginatedResult,
  VendorMasterLookupResult,
  VendorTrackerEntry,
  VendorTrackerEntryBankUpdateInput,
} from '../../shared';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { Toast } from '../common/Toast';
import { SearchIcon } from '../common/SearchIcon';
import { VendorAttachmentsModal } from './VendorAttachmentsModal';
import { VendorBankRequestModal } from './VendorBankRequestModal';
import { blankBankForm, bankFormFromEntry, toBankUpdatePayload, type VendorBankFormState } from './vendorTrackerForm';

import '../../pages/Tracker.css';
import './VendorManagement.css';

const PAGE_SIZE = 50;
// A tracked vendor's bank/contact fields are still "Refreshing…" from the background detail
// scrape for the first few seconds after being added — poll briefly rather than making the user
// reload the page to see it resolve.
const PENDING_REFETCH_MS = 4000;

// The 3 vendor-level fields this module checks for completeness (Vendor Details column).
const VENDOR_DETAIL_FIELDS: Array<[keyof VendorTrackerEntry, string]> = [
  ['vendorEmail', 'Email'],
  ['vendorPhone1', 'Mobile'],
  ['vendorAddress', 'Address'],
];

// The 6 fields this module checks both in SmartPAL's own Bank Details tab (Bank Details Status
// column, via bankDetailsInPalMissingFields from the backend) and in our manually-keyed Verified
// Bank Fields column.
const BANK_FIELD_LABELS: Array<[keyof VendorTrackerEntry, string]> = [
  ['bankBeneficiaryName', 'Beneficiary Name'],
  ['bankName', 'Bank Name'],
  ['bankBranchName', 'Branch Name'],
  ['bankAccountNumber', 'Account Number'],
  ['bankIban', 'IBAN'],
  ['bankSwiftCode', 'Swift Code'],
];

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

function EditPenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// A row's present/missing state, rendered as a small check/cross chip — shared look for the
// Vendor Details, Bank Details Status, and Verified Bank Fields columns' field checklists.
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

export function VendorManagementPage() {
  const { canEdit } = useRole();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pickerValue, setPickerValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bankEditId, setBankEditId] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState<VendorBankFormState>(blankBankForm());
  const [attachmentsEntry, setAttachmentsEntry] = useState<VendorTrackerEntry | null>(null);
  const [bankRequestEntry, setBankRequestEntry] = useState<VendorTrackerEntry | null>(null);

  const queryClient = useQueryClient();

  const vendorOptionsQuery = useQuery({
    queryKey: ['vendor-options'],
    queryFn: () => api.get<VendorMasterLookupResult[]>('/vendor-management/vendor-options'),
  });

  const entriesQuery = useQuery({
    queryKey: ['vendor-tracker', search, page],
    queryFn: () =>
      api.get<PaginatedResult<VendorTrackerEntry>>(
        `/vendor-management?${new URLSearchParams({ search, page: String(page), page_size: String(PAGE_SIZE) }).toString()}`
      ),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((e) => e.detailScrapePending) ? PENDING_REFETCH_MS : false;
    },
  });

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

  const vendorPickerOptions: SearchableSelectOption[] = useMemo(() => {
    const tracked = new Set((entriesQuery.data?.items ?? []).map((e) => e.vendorCode));
    return (vendorOptionsQuery.data ?? [])
      .filter((v) => !tracked.has(v.vendorCode))
      .map((v) => ({ value: v.vendorCode, label: v.vendorName ? `${v.vendorName} (${v.vendorCode})` : v.vendorCode }));
  }, [vendorOptionsQuery.data, entriesQuery.data]);

  const addMutation = useMutation({
    mutationFn: (vendorCode: string) => api.post<VendorTrackerEntry>('/vendor-management', { vendorCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] });
      setPickerValue('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add vendor.'),
  });

  const refreshMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/refresh`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to refresh vendor.'),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/mark-bank-received`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to mark bank details received.'),
  });

  const saveBankMutation = useMutation({
    mutationFn: (payload: VendorTrackerEntryBankUpdateInput) =>
      api.patch<VendorTrackerEntry>(`/vendor-management/${bankEditId}/bank-details`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] });
      setBankEditId(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save bank details.'),
  });

  const markVerifiedMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/mark-verification-completed`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to mark verification completed.'),
  });

  function startBankEdit(entry: VendorTrackerEntry) {
    setBankEditId(entry.id);
    setBankForm(bankFormFromEntry(entry));
  }

  function formatDate(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleDateString();
  }

  function missingFields(entry: VendorTrackerEntry, fields: Array<[keyof VendorTrackerEntry, string]>): string[] {
    return fields.filter(([key]) => !entry[key]).map(([, label]) => label);
  }

  return (
    <div className="tracker-page vendor-management-page">
      <div className="tracker-page-header">
        <h1 className="tracker-page-title">Vendor Management</h1>
        <div className="tracker-page-count">
          <span className="count-number">{entriesQuery.data?.total ?? 0}</span>
          <span className="count-label">Vendors</span>
        </div>
      </div>
      <p className="vendor-management-auto-note">
        Pick a vendor from the SmartPAL vendor master below to start tracking its Vendor Details, Bank Details, and
        Bank Verification status here.
      </p>

      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search tracked vendors by code…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="tracker-toolbar-spacer" />
        {canEdit && (
          <SearchableSelect
            options={vendorPickerOptions}
            value={pickerValue}
            onChange={(v) => {
              setPickerValue(v);
              if (v) addMutation.mutate(v);
            }}
            placeholder="+ Add DD Vendor"
          />
        )}
      </div>

      {entriesQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading tracked vendors…</div>
          </div>
        </div>
      ) : entriesQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load tracked vendors.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell vendor-management-table-shell">
            <table className="data-table vendor-management-table">
              <thead>
                <tr>
                  <th className="col-sno">S.No</th>
                  <th className="col-vendor">Vendor</th>
                  <th className="col-vendor-details" title="Email, Mobile, and Address, read live from SmartPAL's vendor master.">Vendor Details</th>
                  <th className="col-bank-status" title="The 6 mandatory bank fields, read live from SmartPAL's own Bank Details tab.">Bank Details Status</th>
                  <th className="col-verified-bank" title="Manually verified bank details, keyed in after the vendor replies on letterhead — separate from what SmartPAL already shows.">
                    Verified Bank Fields
                  </th>
                  <th className="col-verification">Bank Verification</th>
                  <th className="col-center col-docs" title="SmartPAL scraped master documents and verified bank reply attachments">Full Documents</th>
                </tr>
              </thead>
              <tbody>
                {(entriesQuery.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">No vendors are being tracked yet.</td>
                  </tr>
                )}
                {(entriesQuery.data?.items ?? []).map((entry, idx) => {
                  const rowNumber = (page - 1) * PAGE_SIZE + idx + 1;
                  const missingVerifiedBank = missingFields(entry, BANK_FIELD_LABELS);
                  const palMissing = entry.bankDetailsInPalMissingFields ?? [];
                  const palComplete = entry.bankDetailsInPalComplete;

                  return (
                    <tr key={entry.id}>
                      <td className="col-sno">
                        <span className="vendor-sno-pill">{rowNumber}</span>
                      </td>
                      <td className="col-vendor">
                        <div className="vendor-name-text">{entry.vendorName ?? entry.vendorCode}</div>
                        <div className="vendor-code-badge">{entry.vendorCode}</div>
                      </td>
                      <td className="col-vendor-details">
                        {entry.detailScrapePending ? (
                          <span className="vendor-badge vendor-badge-pending">
                            <span className="vendor-badge-dot" />
                            Refreshing…
                          </span>
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
                            onClick={() => refreshMutation.mutate(entry.id)}
                            disabled={refreshMutation.isPending}
                          >
                            <RefreshIcon />
                            <span>{refreshMutation.isPending ? 'Refreshing…' : 'Refresh'}</span>
                          </button>
                        )}
                      </td>
                      <td className="col-bank-status">
                        <div style={{ marginBottom: 6 }}>
                          <span className={`vendor-badge vendor-badge-status-${entry.bankDetailsStatus}`}>
                            <span className="vendor-badge-dot" />
                            {BANK_DETAILS_STATUS_LABELS[entry.bankDetailsStatus as BankDetailsStatus] ?? entry.bankDetailsStatus}
                          </span>
                        </div>
                        <FieldChecklist
                          items={BANK_FIELD_LABELS.map(([, label]) => ({ label, present: !palMissing.includes(label) }))}
                        />
                      </td>
                      <td className="col-verified-bank">
                        {(() => {
                          const canEnterBankFields =
                            palComplete ||
                            entry.bankDetailsStatus === BankDetailsStatus.RECEIVED ||
                            entry.bankDetailsStatus === BankDetailsStatus.UPDATED;
                          return (
                            <>
                              {bankEditId === entry.id ? (
                                <div className="vendor-bank-edit-form">
                                  <input placeholder="Beneficiary Name" value={bankForm.bankBeneficiaryName} onChange={(e) => setBankForm((f) => ({ ...f, bankBeneficiaryName: e.target.value }))} />
                                  <input placeholder="Bank Name" value={bankForm.bankName} onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))} />
                                  <input placeholder="Branch Name" value={bankForm.bankBranchName} onChange={(e) => setBankForm((f) => ({ ...f, bankBranchName: e.target.value }))} />
                                  <input placeholder="Account Number" value={bankForm.bankAccountNumber} onChange={(e) => setBankForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
                                  <input placeholder="IBAN" value={bankForm.bankIban} onChange={(e) => setBankForm((f) => ({ ...f, bankIban: e.target.value }))} />
                                  <input placeholder="Swift Code" value={bankForm.bankSwiftCode} onChange={(e) => setBankForm((f) => ({ ...f, bankSwiftCode: e.target.value }))} />
                                  <div className="vendor-bank-edit-actions">
                                    <button
                                      className="vendor-table-btn vendor-save-btn"
                                      disabled={saveBankMutation.isPending}
                                      onClick={() => saveBankMutation.mutate(toBankUpdatePayload(bankForm))}
                                    >
                                      {saveBankMutation.isPending ? '…' : '✓ Save'}
                                    </button>
                                    <button className="vendor-table-btn vendor-cancel-btn" onClick={() => setBankEditId(null)}>Cancel</button>
                                  </div>
                                </div>
                              ) : (
                                <FieldChecklist
                                  items={BANK_FIELD_LABELS.map(([key, label]) => ({
                                    label,
                                    value: entry[key] ? String(entry[key]) : null,
                                    present: !!entry[key],
                                  }))}
                                />
                              )}
                              {canEdit && bankEditId !== entry.id && (
                                <div className="vendor-action-buttons">
                                  {!palComplete && (
                                    <>
                                      {entry.bankDetailsStatus === BankDetailsStatus.MISSING && (
                                        <button
                                          className="vendor-table-btn vendor-btn-request"
                                          onClick={() => setBankRequestEntry(entry)}
                                        >
                                          Send Bank Details Request
                                        </button>
                                      )}
                                      {(entry.bankDetailsStatus === BankDetailsStatus.MISSING || entry.bankDetailsStatus === BankDetailsStatus.REQUESTED) && (
                                        <button
                                          className="vendor-table-btn vendor-btn-secondary"
                                          disabled={markReceivedMutation.isPending}
                                          onClick={() => markReceivedMutation.mutate(entry.id)}
                                        >
                                          Mark Received
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {canEnterBankFields && (
                                    <button className="vendor-table-btn vendor-btn-edit" onClick={() => startBankEdit(entry)}>
                                      <EditPenIcon />
                                      <span>{missingVerifiedBank.length === 0 ? 'Edit Bank Fields' : 'Enter Bank Fields'}</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="col-verification">
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
                            disabled={!palComplete || markVerifiedMutation.isPending}
                            title={!palComplete ? `All mandatory bank fields must be present in SmartPAL first (missing: ${palMissing.join(', ')})` : undefined}
                            onClick={() => markVerifiedMutation.mutate(entry.id)}
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
                      </td>
                      <td className="col-center col-docs">
                        <button
                          className="vendor-full-docs-btn"
                          title="View all SmartPAL scraped documents & verified bank reply attachments"
                          onClick={() => setAttachmentsEntry(entry)}
                        >
                          <DocumentsIcon />
                          <span>Full Documents</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tracker-pagination">
            <div className="pagination-center">
              <button className="pagination-nav-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title="Previous Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="pagination-current">
                Page <strong>{page}</strong> of {totalPages}
              </div>
              <button className="pagination-nav-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} title="Next Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div className="pagination-right">
              <span className="pagination-total">
                {entriesQuery.data ? (
                  <><strong>{entriesQuery.data.total.toLocaleString()}</strong> vendors tracked</>
                ) : (
                  '...'
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {attachmentsEntry && (
        <VendorAttachmentsModal entry={attachmentsEntry} canEdit={canEdit} onClose={() => setAttachmentsEntry(null)} />
      )}

      {bankRequestEntry && (
        <VendorBankRequestModal
          entry={bankRequestEntry}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] });
            setBankRequestEntry(null);
          }}
          onClose={() => setBankRequestEntry(null)}
        />
      )}

      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
