import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../auth/useRole';
import { api, ApiError } from '../../lib/api';
import type { PaginatedResult, TrackedVendorEntry, VendorMasterLookupResult, VendorTrackerEntry } from '../../shared';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { Toast } from '../common/Toast';
import { SearchIcon } from '../common/SearchIcon';
import { VendorAttachmentsModal } from './VendorAttachmentsModal';
import { VendorBankRequestModal } from './VendorBankRequestModal';
import { VendorManagementTable } from './VendorManagementTable';
import { VendorVerificationCompleteModal } from './VendorVerificationCompleteModal';
import { VendorVerificationReminderModal } from './VendorVerificationReminderModal';

import '../../pages/Tracker.css';
import './VendorManagement.css';

const PAGE_SIZE = 50;

type VendorTab = 'dd' | 'all';

function buildListUrl(path: string, search: string, page: number, pageSize: number = PAGE_SIZE): string {
  return `${path}?${new URLSearchParams({ search, page: String(page), page_size: String(pageSize) }).toString()}`;
}

export function VendorManagementPage() {
  const { canEdit } = useRole();
  const [activeTab, setActiveTab] = useState<VendorTab>('dd');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pickerValue, setPickerValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attachmentsEntry, setAttachmentsEntry] = useState<TrackedVendorEntry | null>(null);
  const [bankRequestEntry, setBankRequestEntry] = useState<TrackedVendorEntry | null>(null);
  const [verificationReminderEntry, setVerificationReminderEntry] = useState<TrackedVendorEntry | null>(null);
  const [verificationCompleteEntry, setVerificationCompleteEntry] = useState<TrackedVendorEntry | null>(null);

  const queryClient = useQueryClient();

  function switchTab(tab: VendorTab) {
    setActiveTab(tab);
    setSearch('');
    setPage(1);
  }

  function invalidateLists() {
    queryClient.invalidateQueries({ queryKey: ['vendor-tracker'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-tracker-all'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-tracker-count'] });
    queryClient.invalidateQueries({ queryKey: ['vendor-tracker-all-count'] });
  }

  const vendorOptionsQuery = useQuery({
    queryKey: ['vendor-options'],
    queryFn: () => api.get<VendorMasterLookupResult[]>('/vendor-management/vendor-options'),
  });

  // Lightweight counts for the tab bar badges — fetched regardless of which tab is active (both
  // are cheap, page_size=1 reads) so switching tabs doesn't need to wait on a count.
  const ddCountQuery = useQuery({
    queryKey: ['vendor-tracker-count'],
    queryFn: () => api.get<PaginatedResult<VendorTrackerEntry>>(buildListUrl('/vendor-management', '', 1, 1)),
  });
  const allCountQuery = useQuery({
    queryKey: ['vendor-tracker-all-count'],
    queryFn: () => api.get<PaginatedResult<VendorTrackerEntry>>(buildListUrl('/vendor-management/all', '', 1, 1)),
  });

  const ddEntriesQuery = useQuery({
    queryKey: ['vendor-tracker', search, page],
    queryFn: () => api.get<PaginatedResult<VendorTrackerEntry>>(buildListUrl('/vendor-management', search, page)),
    enabled: activeTab === 'dd',
    placeholderData: keepPreviousData,
  });

  const allEntriesQuery = useQuery({
    queryKey: ['vendor-tracker-all', search, page],
    queryFn: () => api.get<PaginatedResult<VendorTrackerEntry>>(buildListUrl('/vendor-management/all', search, page)),
    enabled: activeTab === 'all',
    placeholderData: keepPreviousData,
  });

  const entriesQuery = activeTab === 'dd' ? ddEntriesQuery : allEntriesQuery;
  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

  const vendorPickerOptions: SearchableSelectOption[] = useMemo(() => {
    const alreadyDd = new Set((ddEntriesQuery.data?.items ?? []).map((e) => e.vendorCode));
    return (vendorOptionsQuery.data ?? [])
      .filter((v) => !alreadyDd.has(v.vendorCode))
      .map((v) => ({ value: v.vendorCode, label: v.vendorName ? `${v.vendorName} (${v.vendorCode})` : v.vendorCode }));
  }, [vendorOptionsQuery.data, ddEntriesQuery.data]);

  const addMutation = useMutation({
    mutationFn: (vendorCode: string) => api.post<VendorTrackerEntry>('/vendor-management', { vendorCode }),
    onSuccess: () => {
      invalidateLists();
      setPickerValue('');
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to add vendor.'),
  });

  // Get-or-create the backing vendor_tracker_entries row for an "All Vendors" tab row that
  // doesn't have one yet (id === null) — every action below calls this first. A no-op (no network
  // call) when the row already has an id, so the exact same handlers work for both tabs.
  const ensureTrackingMutation = useMutation({
    mutationFn: (vendorCode: string) =>
      api.post<VendorTrackerEntry>(`/vendor-management/by-vendor-code/${encodeURIComponent(vendorCode)}/ensure-tracking`, {}),
  });

  async function ensureTrackingId(entry: VendorTrackerEntry): Promise<TrackedVendorEntry> {
    if (entry.id) return entry as TrackedVendorEntry;
    try {
      const created = await ensureTrackingMutation.mutateAsync(entry.vendorCode);
      invalidateLists();
      return created as TrackedVendorEntry;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start tracking this vendor.');
      throw err;
    }
  }

  const refreshMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/refresh`, {}),
    onSuccess: invalidateLists,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to refresh vendor.'),
  });

  const markReceivedMutation = useMutation({
    mutationFn: (entryId: string) => api.post<VendorTrackerEntry>(`/vendor-management/${entryId}/mark-bank-received`, {}),
    onSuccess: invalidateLists,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to mark bank details received.'),
  });

  async function handleRefresh(entry: VendorTrackerEntry) {
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) refreshMutation.mutate(tracked.id);
  }
  async function handleMarkReceived(entry: VendorTrackerEntry) {
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) markReceivedMutation.mutate(tracked.id);
  }
  async function handleSendBankRequest(entry: VendorTrackerEntry) {
    setError(null);
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) setBankRequestEntry(tracked);
  }
  async function handleSendVerificationReminder(entry: VendorTrackerEntry) {
    setError(null);
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) setVerificationReminderEntry(tracked);
  }
  async function handleOpenVerificationComplete(entry: VendorTrackerEntry) {
    setError(null);
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) setVerificationCompleteEntry(tracked);
  }
  async function handleOpenDocuments(entry: VendorTrackerEntry) {
    setError(null);
    const tracked = await ensureTrackingId(entry).catch(() => null);
    if (tracked) setAttachmentsEntry(tracked);
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
        "DD Vendors" are vendors explicitly added for the bank-details-request/verification workflow — "All Vendors"
        is the full SmartPAL vendor master. Every action works the same in either tab; taking one on a vendor that
        isn't a DD Vendor yet just starts tracking it.
      </p>

      <div className="vendor-docs-tabs" style={{ marginBottom: 14 }}>
        <button type="button" className={`vendor-docs-tab-btn ${activeTab === 'dd' ? 'active' : ''}`} onClick={() => switchTab('dd')}>
          DD Vendors
          <span className="vendor-docs-tab-count">{ddCountQuery.data?.total ?? '—'}</span>
        </button>
        <button type="button" className={`vendor-docs-tab-btn ${activeTab === 'all' ? 'active' : ''}`} onClick={() => switchTab('all')}>
          All Vendors
          <span className="vendor-docs-tab-count">{allCountQuery.data?.total ?? '—'}</span>
        </button>
      </div>

      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder={activeTab === 'dd' ? 'Search tracked vendors by code…' : 'Search vendors by code or name…'}
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="tracker-toolbar-spacer" />
        {canEdit && activeTab === 'dd' && (
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
            <div>Loading vendors…</div>
          </div>
        </div>
      ) : entriesQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load vendors.</div>
        </div>
      ) : (
        <>
          <VendorManagementTable
            entries={entriesQuery.data?.items ?? []}
            page={page}
            pageSize={PAGE_SIZE}
            canEdit={canEdit}
            isRefreshPending={refreshMutation.isPending || ensureTrackingMutation.isPending}
            onRefresh={handleRefresh}
            isMarkReceivedPending={markReceivedMutation.isPending || ensureTrackingMutation.isPending}
            onMarkReceived={handleMarkReceived}
            onSendBankRequest={handleSendBankRequest}
            onSendVerificationReminder={handleSendVerificationReminder}
            onOpenVerificationComplete={handleOpenVerificationComplete}
            onOpenDocuments={handleOpenDocuments}
            emptyMessage={activeTab === 'dd' ? 'No vendors are being tracked yet.' : 'No vendors match the current search.'}
          />
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
                  <><strong>{entriesQuery.data.total.toLocaleString()}</strong> vendors</>
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
            invalidateLists();
            setBankRequestEntry(null);
          }}
          onClose={() => setBankRequestEntry(null)}
        />
      )}

      {verificationReminderEntry && (
        <VendorVerificationReminderModal
          entry={verificationReminderEntry}
          onSent={() => {
            invalidateLists();
            setVerificationReminderEntry(null);
          }}
          onClose={() => setVerificationReminderEntry(null)}
        />
      )}

      {verificationCompleteEntry && (
        <VendorVerificationCompleteModal
          entry={verificationCompleteEntry}
          onCompleted={() => {
            invalidateLists();
            setVerificationCompleteEntry(null);
          }}
          onClose={() => setVerificationCompleteEntry(null)}
        />
      )}

      {error && <Toast type="error" message={error} onClose={() => setError(null)} duration={5000} />}
    </div>
  );
}
