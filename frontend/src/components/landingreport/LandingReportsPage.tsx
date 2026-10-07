import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRole } from '../../auth/useRole';
import { api, ApiError } from '../../lib/api';
import { OilType, type LandingReport, type PaginatedResult, type Vessel } from '../../shared';
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_COL_WIDTHS,
  LandingReportsTable,
  type ReorderableColumnKey,
  type SortColumn,
} from './LandingReportsTable';
import { LandingReportModal } from './LandingReportModal';
import { ConfirmDialog } from '../modals/ConfirmDialog';
import { Toast } from '../common/Toast';
import { MultiSelectDropdown } from '../common/MultiSelectDropdown';
import { MoreFiltersPopover } from '../common/MoreFiltersPopover';
import { SearchIcon } from '../common/SearchIcon';

import '../../pages/Tracker.css';
import '../../pages/LandingReports.css';

const TABLE_KEY = 'landing_reports';

const OIL_TYPE_OPTIONS = Object.values(OilType).map((o) => ({ value: o, label: o }));

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];
const MIN_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 1000;

interface LandingFilters {
  search: string;
  oilTypes: string[];
  vesselIds: string[];
  offlandedDateFrom: string;
  offlandedDateTo: string;
}

const DEFAULT_FILTERS: LandingFilters = {
  search: '',
  oilTypes: [],
  vesselIds: [],
  offlandedDateFrom: '',
  offlandedDateTo: '',
};

interface TableLayoutPreference {
  tableKey: string;
  columnOrder: string[];
  columnWidths: Record<string, number>;
  pageSize: number | null;
  filters: Partial<LandingFilters> | null;
}

// Query param names match backend/app/api/routes/landing_reports.py 1:1.
function buildQueryParams(
  filters: LandingFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  filters.oilTypes.forEach((o) => params.append('oil_type', o));
  filters.vesselIds.forEach((v) => params.append('vessel_id', v));
  if (filters.offlandedDateFrom) params.set('offlanded_date_from', filters.offlandedDateFrom);
  if (filters.offlandedDateTo) params.set('offlanded_date_to', filters.offlandedDateTo);
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

function sanitizeColumnOrder(saved: string[] | null | undefined): ReorderableColumnKey[] {
  const known = new Set<string>(DEFAULT_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is ReorderableColumnKey => known.has(k));
  const missing = DEFAULT_COLUMN_ORDER.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_COL_WIDTHS) as ReorderableColumnKey[]) {
    const w = saved?.[key];
    result[key] = typeof w === 'number' && w >= 60 && w <= 1000 ? w : DEFAULT_COL_WIDTHS[key];
  }
  return result;
}

export function LandingReportsPage() {
  const { canEdit } = useRole();
  const [filters, setFilters] = useState<LandingFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [customPageSizeInput, setCustomPageSizeInput] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [layoutEditable, setLayoutEditable] = useState(false);
  const [savedColumnOrder, setSavedColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [savedColumnWidths, setSavedColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });
  const [columnOrder, setColumnOrder] = useState<ReorderableColumnKey[]>([...DEFAULT_COLUMN_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_COL_WIDTHS });

  const [editing, setEditing] = useState<LandingReport | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deleting, setDeleting] = useState<LandingReport | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  // Guards the one-time restore of the saved preference and the auto-save-filters effect below,
  // so the latter doesn't fire before the restore has settled and overwrite what it just loaded.
  const initializedRef = useRef(false);

  // All vessels (including those not flagged "Show in PI dropdown"), for the vessel filters.
  const vesselsQuery = useQuery({
    queryKey: ['vessels', 'all'],
    queryFn: () => api.get<Vessel[]>('/vessels?include_inactive=true'),
  });

  const tableLayoutQuery = useQuery({
    queryKey: ['table-layout', TABLE_KEY],
    queryFn: () => api.get<TableLayoutPreference | null>(`/table-layout/${TABLE_KEY}`),
  });

  // Seed column layout, page size and filters from the user's saved preference once it loads.
  useEffect(() => {
    if (tableLayoutQuery.data === undefined) return;
    const order = sanitizeColumnOrder(tableLayoutQuery.data?.columnOrder);
    const widths = sanitizeColumnWidths(tableLayoutQuery.data?.columnWidths);
    setSavedColumnOrder(order);
    setSavedColumnWidths(widths);
    setColumnOrder(order);
    setColumnWidths(widths);
    if (tableLayoutQuery.data?.pageSize) {
      setPageSize(tableLayoutQuery.data.pageSize);
    }
    if (!initializedRef.current) {
      setFilters({ ...DEFAULT_FILTERS, ...(tableLayoutQuery.data?.filters ?? {}) });
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableLayoutQuery.data]);

  const saveLayoutMutation = useMutation({
    mutationFn: () => api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { columnOrder, columnWidths }),
    onSuccess: () => {
      setSavedColumnOrder(columnOrder);
      setSavedColumnWidths(columnWidths);
      setLayoutEditable(false);
    },
  });

  const savePageSizeMutation = useMutation({
    mutationFn: (size: number) => api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { pageSize: size }),
  });

  const saveFiltersMutation = useMutation({
    mutationFn: (next: LandingFilters) => api.put<TableLayoutPreference>(`/table-layout/${TABLE_KEY}`, { filters: next }),
  });

  // Debounced auto-save of the last-used filters (same behavior as the Tracker).
  useEffect(() => {
    if (!initializedRef.current) return;
    const timeout = setTimeout(() => saveFiltersMutation.mutate(filters), 600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  function startLayoutEdit() {
    setLayoutEditable(true);
  }

  function cancelLayoutEdit() {
    setColumnOrder(savedColumnOrder);
    setColumnWidths(savedColumnWidths);
    setLayoutEditable(false);
  }

  function applyPageSize(size: number) {
    const clamped = Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.round(size)));
    setPageSize(clamped);
    setPage(1);
    setCustomPageSizeInput('');
    savePageSizeMutation.mutate(clamped);
  }

  // Every filter control goes through this so changing any filter always resets to page 1.
  function updateFilters(patch: Partial<LandingFilters>) {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function clearAllFilters() {
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  }

  const reportsQuery = useQuery({
    queryKey: ['landing-reports', filters, sortBy, sortDir, page, pageSize],
    queryFn: () =>
      api.get<PaginatedResult<LandingReport>>(
        `/landing-reports?${buildQueryParams(filters, sortBy, sortDir, page, pageSize).toString()}`
      ),
    // Keeps the current rows on screen while a re-sort/re-filter fetches in the background.
    placeholderData: keepPreviousData,
  });

  const totalPages = reportsQuery.data ? Math.max(1, Math.ceil(reportsQuery.data.total / pageSize)) : 1;

  // Cycles asc -> desc -> neutral (default S.No order) -> asc on repeated clicks of one header.
  function handleSort(column: SortColumn) {
    if (sortBy === column) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortBy(null);
        setSortDir('desc');
      }
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
    setPage(1);
  }

  // Exports exactly the rows the current filters would return — same params as the list fetch,
  // minus pagination.
  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const params = buildQueryParams(filters, sortBy, sortDir, page, pageSize);
      params.delete('page');
      params.delete('page_size');
      const { blob, filename } = await api.getBlob(`/landing-reports/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'Landing_Reports.xlsx';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to export.');
    } finally {
      setIsExporting(false);
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (report: LandingReport) => api.delete(`/landing-reports/${report.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landing-reports'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleting(null);
      setDeleteError(err instanceof ApiError ? err.message : 'Failed to delete landing report.');
    },
  });

  const vesselOptions = (vesselsQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }));

  // Drives the "More filters (N)" badge — everything inside that popover, not Search/Oil Type.
  const moreFiltersActiveCount =
    filters.vesselIds.length + [filters.offlandedDateFrom, filters.offlandedDateTo].filter(Boolean).length;
  const hasAnyActiveFilter = filters.search !== '' || filters.oilTypes.length > 0 || moreFiltersActiveCount > 0;

  return (
    <div className="tracker-page landing-reports-page">
      <div className="tracker-page-header">
        <h1 className="tracker-page-title">Landing Reports</h1>
        <div className="tracker-page-count">
          <span className="count-number">{reportsQuery.data?.total ?? 0}</span>
          <span className="count-label">Landing Reports</span>
        </div>
      </div>
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search vessel, port, oil type, status…"
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
          />
        </div>
        <MultiSelectDropdown
          options={OIL_TYPE_OPTIONS}
          selected={filters.oilTypes}
          onChange={(next) => updateFilters({ oilTypes: next })}
          allLabel="All oil types"
        />
        <MoreFiltersPopover activeCount={moreFiltersActiveCount}>
          {hasAnyActiveFilter && (
            <div className="more-filters-section more-filters-clear-row">
              <button type="button" className="btn btn-secondary" onClick={clearAllFilters}>
                Clear all filters
              </button>
            </div>
          )}
          <div className="more-filters-section">
            <MultiSelectDropdown
              options={vesselOptions}
              selected={filters.vesselIds}
              onChange={(next) => updateFilters({ vesselIds: next })}
              allLabel="All vessels"
            />
          </div>
          <div className="more-filters-section more-filters-dates">
            <div className="date-range-group">
              <div className="date-range-field">
                <label>Offlanded From</label>
                <input
                  type="date"
                  value={filters.offlandedDateFrom}
                  onChange={(e) => updateFilters({ offlandedDateFrom: e.target.value })}
                />
              </div>
              <div className="date-range-field">
                <label>Offlanded To</label>
                <input
                  type="date"
                  value={filters.offlandedDateTo}
                  onChange={(e) => updateFilters({ offlandedDateTo: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="date-range-clear"
                style={{ visibility: filters.offlandedDateFrom || filters.offlandedDateTo ? 'visible' : 'hidden' }}
                title="Clear offlanded date range"
                onClick={() => updateFilters({ offlandedDateFrom: '', offlandedDateTo: '' })}
              >
                ×
              </button>
            </div>
          </div>
        </MoreFiltersPopover>
        <div className="tracker-toolbar-spacer" />
        <button className="btn-tracker-action btn-tracker-secondary" onClick={handleExport} disabled={isExporting}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {isExporting ? 'Exporting…' : 'Export'}
        </button>
        {canEdit && (
          <>
            <button className="btn-tracker-action btn-tracker-primary" onClick={() => setIsAdding(true)} disabled={layoutEditable}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Landing Report
            </button>
            {layoutEditable ? (
              <div className="tracker-layout-edit-group">
                <button className="btn-tracker-action btn-tracker-success" onClick={() => saveLayoutMutation.mutate()} disabled={saveLayoutMutation.isPending}>
                  {saveLayoutMutation.isPending ? 'Saving…' : 'Save Layout'}
                </button>
                <button className="btn-tracker-action btn-tracker-secondary" onClick={cancelLayoutEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-tracker-action btn-tracker-secondary" onClick={startLayoutEdit}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Edit Layout
              </button>
            )}
          </>
        )}
      </div>
      {exportError && (
        <div className="tracker-export-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {exportError}
        </div>
      )}

      {reportsQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading landing reports…</div>
          </div>
        </div>
      ) : reportsQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load landing reports.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell">
            <LandingReportsTable
              reports={reportsQuery.data?.items ?? []}
              canEdit={canEdit}
              vessels={vesselsQuery.data ?? []}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
              onEdit={setEditing}
              onDelete={(r) => {
                setDeleteError(null);
                setDeleting(r);
              }}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              layoutEditable={layoutEditable}
              onReorderColumn={setColumnOrder}
              onResizeColumn={(key, width) => setColumnWidths((prev) => ({ ...prev, [key]: width }))}
              columnFilters={{ vessel: filters.vesselIds, oilType: filters.oilTypes }}
              onColumnFilterChange={(key, values) => {
                if (key === 'vessel') updateFilters({ vesselIds: values });
                if (key === 'oilType') updateFilters({ oilTypes: values });
              }}
            />
          </div>
          <div className="tracker-pagination">
            <div className="pagination-left">
              <span className="pagination-label">Rows per page:</span>
              <div className="pagination-size-pill">
                <select
                  className="pagination-select"
                  value={PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ''}
                  onChange={(e) => {
                    if (e.target.value) applyPageSize(Number(e.target.value));
                  }}
                >
                  {!PAGE_SIZE_OPTIONS.includes(pageSize) && <option value="">{pageSize} (custom)</option>}
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <div className="pagination-custom">
                  <input
                    type="number"
                    placeholder="Custom"
                    min={MIN_PAGE_SIZE}
                    max={MAX_PAGE_SIZE}
                    value={customPageSizeInput}
                    onChange={(e) => setCustomPageSizeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customPageSizeInput) applyPageSize(Number(customPageSizeInput));
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => customPageSizeInput && applyPageSize(Number(customPageSizeInput))}
                    disabled={!customPageSizeInput}
                  >
                    Set
                  </button>
                </div>
              </div>
            </div>

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
                {reportsQuery.data ? (
                  <><strong>{reportsQuery.data.total.toLocaleString()}</strong> reports found</>
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
          title="Delete Landing Report"
          message={`Delete the landing report for ${deleting.vesselName} (S.No ${deleting.seqNo})? This cannot be undone.`}
          isConfirming={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {(isAdding || editing) && (
        <LandingReportModal
          report={editing}
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
