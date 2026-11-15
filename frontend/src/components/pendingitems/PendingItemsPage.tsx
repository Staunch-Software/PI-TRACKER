import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { PaginatedResult, PendingItem, PendingItemsCountEntry, PendingItemsFilterOptions } from '../../shared';
import { MultiSelectDropdown } from '../common/MultiSelectDropdown';
import { MoreFiltersPopover } from '../common/MoreFiltersPopover';
import { SearchIcon } from '../common/SearchIcon';

import '../../pages/Tracker.css';
import './PendingItems.css';

type SortColumn = 'referenceNo' | 'vesselName' | 'vendor' | 'status' | 'ownerName' | 'ageingDays';

const STAGES = ['Requisition', 'Purchase Order', 'Invoice'] as const;
type Stage = (typeof STAGES)[number];

const OWNER_ROLES = ['TSI', 'TA'] as const;
type OwnerRole = (typeof OWNER_ROLES)[number];

interface PendingItemFilters {
  search: string;
  vesselName: string[];
  ownerName: string[];
}

const DEFAULT_FILTERS: PendingItemFilters = {
  search: '',
  vesselName: [],
  ownerName: [],
};

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];

function buildQueryParams(
  stage: Stage,
  ownerRole: OwnerRole,
  filters: PendingItemFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  params.append('stage', stage);
  params.append('owner_role', ownerRole);
  if (filters.search) params.set('search', filters.search);
  filters.vesselName.forEach((v) => params.append('vessel_name', v));
  filters.ownerName.forEach((v) => params.append('owner_name', v));
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

export function PendingItemsPage() {
  const [stage, setStage] = useState<Stage>('Requisition');
  const [ownerRole, setOwnerRole] = useState<OwnerRole>('TSI');
  const [filters, setFilters] = useState<PendingItemFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<SortColumn | null>('ageingDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function selectStage(next: Stage) {
    setStage(next);
    setPage(1);
  }

  function selectOwnerRole(next: OwnerRole) {
    setOwnerRole(next);
    setPage(1);
  }

  function updateFilters(patch: Partial<PendingItemFilters>) {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function clearAllFilters() {
    setPage(1);
    setFilters(DEFAULT_FILTERS);
  }

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

  const filterOptionsQuery = useQuery({
    queryKey: ['pending-items-filter-options'],
    queryFn: () => api.get<PendingItemsFilterOptions>('/pending-items/filter-options'),
  });

  // Counts for every (stage, ownerRole) combo, under the current search/vessel/owner-name
  // filters — badges every tab and sub-tab regardless of which one is currently selected.
  const countsQuery = useQuery({
    queryKey: ['pending-items-counts', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      filters.vesselName.forEach((v) => params.append('vessel_name', v));
      filters.ownerName.forEach((v) => params.append('owner_name', v));
      return api.get<PendingItemsCountEntry[]>(`/pending-items/counts?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  function countFor(s: Stage, role: OwnerRole): number {
    return countsQuery.data?.find((c) => c.stage === s && c.ownerRole === role)?.count ?? 0;
  }

  function stageTotal(s: Stage): number {
    return OWNER_ROLES.reduce((sum, role) => sum + countFor(s, role), 0);
  }

  const itemsQuery = useQuery({
    queryKey: ['pending-items', stage, ownerRole, filters, sortBy, sortDir, page, pageSize],
    queryFn: () =>
      api.get<PaginatedResult<PendingItem>>(
        `/pending-items?${buildQueryParams(stage, ownerRole, filters, sortBy, sortDir, page, pageSize).toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  const totalPages = itemsQuery.data ? Math.max(1, Math.ceil(itemsQuery.data.total / pageSize)) : 1;

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const params = buildQueryParams(stage, ownerRole, filters, sortBy, sortDir, page, pageSize);
      params.delete('page');
      params.delete('page_size');
      const { blob, filename } = await api.getBlob(`/pending-items/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? `${stage.replace(/\s+/g, '_')}_${ownerRole}_Pending.xlsx`;
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

  const vesselOptions = (filterOptionsQuery.data?.vesselName ?? []).map((v) => ({ value: v, label: v }));
  const ownerNameOptions = (filterOptionsQuery.data?.ownerName ?? []).map((v) => ({ value: v, label: v }));

  const moreFiltersActiveCount = filters.ownerName.length;
  const hasAnyActiveFilter = filters.search !== '' || filters.vesselName.length > 0 || moreFiltersActiveCount > 0;

  function sortIndicator(column: SortColumn) {
    if (sortBy !== column) return null;
    return <span className="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  return (
    <div className="tracker-page pending-items-page">
      <div className="tracker-page-header">
        <h1 className="tracker-page-title">TSI / TA Pending Items</h1>
        <div className="tracker-page-count">
          <span className="count-number">{itemsQuery.data?.total ?? 0}</span>
          <span className="count-label">{stage} · {ownerRole} Pending</span>
        </div>
      </div>

      <div className="pending-stage-tabs">
        {STAGES.map((s) => (
          <button
            key={s}
            type="button"
            className={`pending-stage-tab ${stage === s ? 'active' : ''}`}
            onClick={() => selectStage(s)}
          >
            {s}
            <span className="pending-tab-count">{stageTotal(s)}</span>
          </button>
        ))}
      </div>

      <div className="pending-owner-tabs">
        {OWNER_ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={`pending-owner-tab pending-owner-tab-${role.toLowerCase()} ${ownerRole === role ? 'active' : ''}`}
            onClick={() => selectOwnerRole(role)}
          >
            {role} Pending
            <span className="pending-tab-count">{countFor(stage, role)}</span>
          </button>
        ))}
      </div>

      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search reference no., vessel, vendor, owner…"
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
          />
        </div>
        <MultiSelectDropdown
          options={vesselOptions}
          selected={filters.vesselName}
          onChange={(next) => updateFilters({ vesselName: next })}
          allLabel="All vessels"
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
              options={ownerNameOptions}
              selected={filters.ownerName}
              onChange={(next) => updateFilters({ ownerName: next })}
              allLabel="All owners"
            />
          </div>
        </MoreFiltersPopover>
        <div className="tracker-toolbar-spacer" />
        <button className="btn-tracker-action btn-tracker-secondary" onClick={handleExport} disabled={isExporting}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {isExporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {exportError && (
        <div className="tracker-export-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {exportError}
        </div>
      )}

      {itemsQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading pending items…</div>
          </div>
        </div>
      ) : itemsQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load pending items.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell">
           <div className="pending-items-scroll">
            <table className="data-table pending-items-table">
              <colgroup>
                <col style={{ width: 180 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr>
                  <th onClick={() => handleSort('referenceNo')}>Reference No. {sortIndicator('referenceNo')}</th>
                  <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                  <th onClick={() => handleSort('vendor')}>Vendor {sortIndicator('vendor')}</th>
                  <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                  <th onClick={() => handleSort('ownerName')}>{ownerRole} {sortIndicator('ownerName')}</th>
                  <th onClick={() => handleSort('ageingDays')}>Ageing (Days) {sortIndicator('ageingDays')}</th>
                </tr>
              </thead>
              <tbody>
                {(itemsQuery.data?.items ?? []).map((item, idx) => (
                  <tr key={`${item.referenceNo}-${idx}`}>
                    <td>{item.referenceNo ?? '—'}</td>
                    <td>{item.vesselName ?? '—'}</td>
                    <td>{item.vendor ?? '—'}</td>
                    <td>{item.status ?? '—'}</td>
                    <td>{item.ownerName ?? '—'}</td>
                    <td>{item.ageingDays ?? '—'}</td>
                  </tr>
                ))}
                {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pending-items-empty">No {stage.toLowerCase()} items pending with {ownerRole} match the current filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
           </div>
          </div>
          <div className="tracker-pagination">
            <div className="pagination-left">
              <span className="pagination-label">Rows per page:</span>
              <div className="pagination-size-pill">
                <select
                  className="pagination-select"
                  value={PAGE_SIZE_OPTIONS.includes(pageSize) ? pageSize : ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
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
                {itemsQuery.data ? (
                  <><strong>{itemsQuery.data.total.toLocaleString()}</strong> items found</>
                ) : (
                  '...'
                )}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
