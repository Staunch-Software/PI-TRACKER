import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../auth/useRole';
import { api, ApiError } from '../../lib/api';
import type { DdTrackerEntry, PaginatedResult } from '../../shared';
import { DdTrackerModal } from './DdTrackerModal';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { Toast } from '../common/Toast';
import { SearchIcon } from '../common/SearchIcon';

import '../../pages/Tracker.css';
import './DdTracker.css';

const PAGE_SIZE = 50;

function formatAmount(amount: number | string | null, currency: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return '—';
  return `${currency ?? ''} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

export function DdTrackerPage() {
  const { canEdit } = useRole();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DdTrackerEntry | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deleting, setDeleting] = useState<DdTrackerEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const entriesQuery = useQuery({
    queryKey: ['dd-tracker', search, page],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('page_size', String(PAGE_SIZE));
      return api.get<PaginatedResult<DdTrackerEntry>>(`/dd-tracker?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const totalPages = entriesQuery.data ? Math.max(1, Math.ceil(entriesQuery.data.total / PAGE_SIZE)) : 1;

  const deleteMutation = useMutation({
    mutationFn: (entry: DdTrackerEntry) => api.delete(`/dd-tracker/${entry.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dd-tracker'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleting(null);
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete DD Tracker entry.');
    },
  });

  return (
    <div className="tracker-page dd-tracker-page">
      <div className="tracker-page-header">
        <h1 className="tracker-page-title">DD Tracker</h1>
        <div className="tracker-page-count">
          <span className="count-number">{entriesQuery.data?.total ?? 0}</span>
          <span className="count-label">Entries</span>
        </div>
      </div>
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search PR/PO number, vessel, title, remarks…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="tracker-toolbar-spacer" />
        {canEdit && (
          <button className="btn-tracker-action btn-tracker-primary" onClick={() => setIsAdding(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Entry
          </button>
        )}
      </div>

      {entriesQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading DD Tracker entries…</div>
          </div>
        </div>
      ) : entriesQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load DD Tracker entries.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell dd-tracker-table-shell">
            <table className="dd-tracker-table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Type</th>
                  <th>PR Number</th>
                  <th>PO Number</th>
                  <th>Title</th>
                  <th>Vessel</th>
                  <th>Vendor</th>
                  <th>PO Status</th>
                  <th>PO Amount</th>
                  <th>Supply Port</th>
                  <th>PO Acknowledged</th>
                  <th>Order Status</th>
                  <th>Readiness Date</th>
                  <th>Remarks</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {(entriesQuery.data?.items ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.seqNo}</td>
                    <td>{entry.entryType ?? '—'}</td>
                    <td>
                      <div>{entry.requisitionNo ?? '—'}</div>
                      {entry.prStatusLive && <div className="dd-tracker-live-note">{entry.prStatusLive}</div>}
                    </td>
                    <td>
                      <div>{entry.poNo ?? '—'}</div>
                      {entry.poApprovedStatus && <div className="dd-tracker-live-note">{entry.poApprovedStatus}</div>}
                    </td>
                    <td>{entry.title ?? entry.poTitle ?? entry.prTitle ?? '—'}</td>
                    <td>{entry.vesselName ?? '—'}</td>
                    <td>{entry.poVendor ?? '—'}</td>
                    <td>{entry.poApprovedStatus ?? '—'}</td>
                    <td>{formatAmount(entry.poBaseAmount, entry.poBaseCurrency)}</td>
                    <td>{entry.poSchdDelPort ?? '—'}</td>
                    <td>{entry.poConfirmedDate ?? '—'}</td>
                    <td>{entry.orderStatus ?? '—'}</td>
                    <td>{entry.readinessDate ?? '—'}</td>
                    <td>{entry.remarks1 ?? entry.remarks2 ?? '—'}</td>
                    {canEdit && (
                      <td className="dd-tracker-actions">
                        <button className="btn-icon" onClick={() => setEditing(entry)} title="Edit">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button
                          className="btn-icon btn-icon-danger"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(entry);
                          }}
                          title="Delete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {(entriesQuery.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 15 : 14} className="dd-tracker-empty">
                      No DD Tracker entries yet.
                    </td>
                  </tr>
                )}
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
                  <><strong>{entriesQuery.data.total.toLocaleString()}</strong> entries found</>
                ) : (
                  '...'
                )}
              </span>
            </div>
          </div>
        </>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete DD Tracker Entry"
          message={`Delete entry S.No ${deleting.seqNo} (${deleting.requisitionNo ?? deleting.poNo ?? 'no PR/PO'})? This cannot be undone.`}
          isConfirming={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {(isAdding || editing) && (
        <DdTrackerModal
          entry={editing}
          onClose={() => {
            setIsAdding(false);
            setEditing(null);
          }}
        />
      )}

      {deleteError && <Toast type="error" message={deleteError} onClose={() => setDeleteError(null)} duration={5000} />}
    </div>
  );
}
