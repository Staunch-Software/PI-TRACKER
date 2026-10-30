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
import { blankBankForm, bankFormFromEntry, toBankUpdatePayload, type VendorBankFormState } from './vendorTrackerForm';

import '../../pages/Tracker.css';
import './VendorManagement.css';

const PAGE_SIZE = 50;
// A tracked vendor's bank/contact fields are still "Refreshing…" from the background detail
// scrape for the first few seconds after being added — poll briefly rather than making the user
// reload the page to see it resolve.
const PENDING_REFETCH_MS = 4000;

export function VendorManagementPage() {
  const { canEdit } = useRole();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pickerValue, setPickerValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [bankEditId, setBankEditId] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState<VendorBankFormState>(blankBankForm());
  const [attachmentsEntry, setAttachmentsEntry] = useState<VendorTrackerEntry | null>(null);

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

  const sendBankRequestMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/send-bank-request`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to send bank details request.'),
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
                  <th className="col-dpr">S.No</th>
                  <th>Vendor</th>
                  <th>Email</th>
                  <th>Phone 1</th>
                  <th>Address</th>
                  <th>Vendor Details</th>
                  <th>Bank Details Status</th>
                  <th>Bank Fields</th>
                  <th>Bank Verification</th>
                  <th>Documents</th>
                </tr>
              </thead>
              <tbody>
                {(entriesQuery.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={10} className="empty-state">No vendors are being tracked yet.</td>
                  </tr>
                )}
                {(entriesQuery.data?.items ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td className="col-dpr">{entry.seqNo}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{entry.vendorName ?? entry.vendorCode}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{entry.vendorCode}</div>
                    </td>
                    <td>{entry.detailScrapePending ? 'Refreshing…' : entry.vendorEmail ?? '—'}</td>
                    <td>{entry.detailScrapePending ? 'Refreshing…' : entry.vendorPhone1 ?? '—'}</td>
                    <td>{entry.detailScrapePending ? 'Refreshing…' : entry.vendorAddress ?? '—'}</td>
                    <td>
                      {entry.detailScrapePending ? (
                        <span className="vendor-badge vendor-badge-pending">Refreshing…</span>
                      ) : entry.hasMandatoryDetails ? (
                        <span className="vendor-badge vendor-badge-ok">Complete</span>
                      ) : (
                        <span className="vendor-badge vendor-badge-warn">Details missing</span>
                      )}
                      {canEdit && !entry.detailScrapePending && (
                        <button
                          className="icon-btn"
                          style={{ marginLeft: 6 }}
                          title="Refresh from SmartPAL"
                          onClick={() => refreshMutation.mutate(entry.id)}
                          disabled={refreshMutation.isPending}
                        >
                          ↻
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={`vendor-badge vendor-badge-status-${entry.bankDetailsStatus}`}>
                        {BANK_DETAILS_STATUS_LABELS[entry.bankDetailsStatus as BankDetailsStatus] ?? entry.bankDetailsStatus}
                      </span>
                      {entry.bankDetailsCount > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {entry.bankDetailsCount} SmartPAL bank row(s)
                        </div>
                      )}
                    </td>
                    <td>
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
                              className="icon-btn icon-btn-success"
                              disabled={saveBankMutation.isPending}
                              onClick={() => saveBankMutation.mutate(toBankUpdatePayload(bankForm))}
                            >
                              {saveBankMutation.isPending ? '…' : '✓'}
                            </button>
                            <button className="icon-btn icon-btn-muted" onClick={() => setBankEditId(null)}>×</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12.5 }}>
                          <div>{entry.bankName ?? '—'}</div>
                          <div style={{ color: 'var(--color-text-muted)' }}>{entry.bankAccountNumber ?? '—'}</div>
                        </div>
                      )}
                      {canEdit && bankEditId !== entry.id && (
                        <div className="vendor-action-buttons">
                          {entry.bankDetailsStatus === BankDetailsStatus.MISSING && (
                            <button
                              className="btn-tracker-action btn-tracker-secondary"
                              disabled={sendBankRequestMutation.isPending}
                              onClick={() => sendBankRequestMutation.mutate(entry.id)}
                            >
                              Send Bank Details Request
                            </button>
                          )}
                          {(entry.bankDetailsStatus === BankDetailsStatus.MISSING || entry.bankDetailsStatus === BankDetailsStatus.REQUESTED) && (
                            <button
                              className="btn-tracker-action btn-tracker-secondary"
                              disabled={markReceivedMutation.isPending}
                              onClick={() => markReceivedMutation.mutate(entry.id)}
                            >
                              Mark Received
                            </button>
                          )}
                          {(entry.bankDetailsStatus === BankDetailsStatus.RECEIVED || entry.bankDetailsStatus === BankDetailsStatus.UPDATED) && (
                            <button className="btn-tracker-action btn-tracker-secondary" onClick={() => startBankEdit(entry)}>
                              {entry.bankDetailsStatus === BankDetailsStatus.UPDATED ? 'Edit Bank Fields' : 'Enter Bank Fields'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {entry.bankVerificationCompleted ? (
                        <span className="vendor-badge vendor-badge-ok">
                          Verified{entry.bankVerificationCompletedByName ? ` — ${entry.bankVerificationCompletedByName}` : ''}
                        </span>
                      ) : canEdit ? (
                        <button
                          className="btn-tracker-action btn-tracker-secondary"
                          disabled={entry.bankDetailsStatus !== BankDetailsStatus.UPDATED || markVerifiedMutation.isPending}
                          title={entry.bankDetailsStatus !== BankDetailsStatus.UPDATED ? 'Bank details must be keyed in first' : undefined}
                          onClick={() => markVerifiedMutation.mutate(entry.id)}
                        >
                          Mark Verification Completed
                        </button>
                      ) : (
                        <span className="vendor-badge vendor-badge-warn">Not verified</span>
                      )}
                      {entry.bankVerificationCompletedAt && (
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {formatDate(entry.bankVerificationCompletedAt)}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className="btn-tracker-action btn-tracker-secondary" onClick={() => setAttachmentsEntry(entry)}>
                        Documents
                      </button>
                    </td>
                  </tr>
                ))}
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

      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
