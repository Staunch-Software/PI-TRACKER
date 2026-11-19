import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type {
  PaginatedResult,
  PendingItem,
  PendingItemsCountEntry,
  PendingItemsFilterOptions,
  PendingStageBreakdown,
} from '../../shared';
import { SearchIcon } from '../common/SearchIcon';
import { PendingDashboardPage } from './PendingDashboardPage';

import '../../pages/Tracker.css';
import './PendingItems.css';

type SortColumn = 'referenceNo' | 'title' | 'vesselName' | 'vendor' | 'status' | 'ownerName' | 'ageingDays' | 'referenceDate';

const STAGES = ['Requisition', 'Purchase Order', 'Invoice'] as const;
type Stage = (typeof STAGES)[number];

type OwnerRoleFilter = 'ALL' | 'TSI' | 'TA';

interface PendingItemFilters {
  search: string;
  vesselName: string[];
  ownerName: string[];
  ageingBracket: string;
}

const DEFAULT_FILTERS: PendingItemFilters = {
  search: '',
  vesselName: [],
  ownerName: [],
  ageingBracket: '',
};

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100, 150, 200];

const AGEING_OPTIONS = [
  { label: '< 7 Days', value: '< 7 Days' },
  { label: '7 - 14 Days', value: '7 - 14 Days' },
  { label: '15 - 30 Days', value: '15 - 30 Days' },
  { label: '> 30 Days', value: '> 30 Days' },
];

function buildQueryParams(
  stage: Stage,
  ownerRoleFilter: OwnerRoleFilter,
  filters: PendingItemFilters,
  sortBy: SortColumn | null,
  sortDir: 'asc' | 'desc',
  page: number,
  pageSize: number
): URLSearchParams {
  const params = new URLSearchParams();
  params.append('stage', stage);
  if (ownerRoleFilter !== 'ALL') {
    params.append('owner_role', ownerRoleFilter);
  }
  if (filters.search) params.set('search', filters.search);
  filters.vesselName.forEach((v) => params.append('vessel_name', v));
  filters.ownerName.forEach((v) => params.append('owner_name', v));
  if (filters.ageingBracket) {
    params.set('ageing_bracket', filters.ageingBracket);
  }
  if (sortBy) {
    params.set('sort_by', sortBy);
    params.set('sort_dir', sortDir);
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return params;
}

function getInitials(name: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

function getAgeingClass(days: number | null): string {
  if (days === null) return '';
  if (days <= 7) return 'ageing-green';
  if (days <= 30) return 'ageing-yellow';
  return 'ageing-red';
}

function renderStatusPill(stage: Stage, status: string | null, ownerRole: string) {
  const s = status || '—';
  const lower = s.toLowerCase();
  const isPending = lower.includes('pending');
  const isApproved = lower.includes('approved');

  let label = s;
  if (stage === 'Requisition') {
    if (s === 'Pending') label = 'Pending (TSI)';
    else if (s === 'Approved') label = 'Pending (TA)';
  } else if (stage === 'Purchase Order') {
    if (s === 'Pending') label = 'Pending (TA)';
    else if (s === 'Approved') label = 'Approved (TSI)';
  } else if (stage === 'Invoice') {
    if (isPending) label = `Pending (${ownerRole})`;
    else if (isApproved) label = `Approved (${ownerRole})`;
  }

  const pillClass = isPending ? 'status-pending' : isApproved ? 'status-approved' : 'status-neutral';

  return (
    <span className={`pending-status-pill ${pillClass}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

interface DropdownProps {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (val: string) => void;
}

function Dropdown({ label, value, options, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const displayLabel = value || label;
  const hasValue = Boolean(value && value !== label);

  return (
    <div className="toolbar-dropdown" ref={ref}>
      <button
        type="button"
        className={`toolbar-dropdown-btn ${hasValue ? 'has-value' : ''}`}
        onClick={() => setOpen(!open)}
      >
        <span>{displayLabel}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="toolbar-dropdown-menu">
          <button
            type="button"
            className={`toolbar-dropdown-item ${!value ? 'selected' : ''}`}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            {label}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`toolbar-dropdown-item ${value === opt.value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {value === opt.value && <span>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PendingItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') === 'items' ? 'items' : 'dashboard';

  function setActiveView(view: 'dashboard' | 'items') {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'items') {
        next.set('view', 'items');
      } else {
        next.delete('view');
      }
      return next;
    });
  }

  const [stage, setStage] = useState<Stage>('Requisition');
  const [ownerRoleFilter, setOwnerRoleFilter] = useState<OwnerRoleFilter>('ALL');
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [filters, setFilters] = useState<PendingItemFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<SortColumn | null>('ageingDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function handleDrillDown(
    targetStage: Stage | null,
    targetRole: 'TSI' | 'TA',
    targetOwner?: string,
    targetVessel?: string
  ) {
    if (targetStage) {
      setStage(targetStage);
    }
    setOwnerRoleFilter(targetRole);
    setFilters({
      search: '',
      vesselName: targetVessel ? [targetVessel] : [],
      ownerName: targetOwner ? [targetOwner] : [],
      ageingBracket: '',
    });
    setPage(1);
    setActiveView('items');
  }

  function selectStage(next: Stage) {
    setStage(next);
    setPage(1);
  }

  function selectRoleFilter(next: OwnerRoleFilter) {
    setOwnerRoleFilter(next);
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

  const breakdownQuery = useQuery({
    queryKey: ['pending-items-breakdown', stage],
    queryFn: () => api.get<PendingStageBreakdown>(`/pending-items/breakdown?stage=${stage}`),
    placeholderData: keepPreviousData,
  });

  const countsQuery = useQuery({
    queryKey: ['pending-items-counts', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      filters.vesselName.forEach((v) => params.append('vessel_name', v));
      filters.ownerName.forEach((v) => params.append('owner_name', v));
      if (filters.ageingBracket) params.set('ageing_bracket', filters.ageingBracket);
      return api.get<PendingItemsCountEntry[]>(`/pending-items/counts?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  function countFor(s: Stage, role: 'TSI' | 'TA'): number {
    return countsQuery.data?.find((c) => c.stage === s && c.ownerRole === role)?.count ?? 0;
  }

  function stageTotal(s: Stage): number {
    return countFor(s, 'TSI') + countFor(s, 'TA');
  }

  const itemsQuery = useQuery({
    queryKey: ['pending-items', stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize],
    queryFn: () =>
      api.get<PaginatedResult<PendingItem>>(
        `/pending-items?${buildQueryParams(stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize).toString()}`
      ),
    placeholderData: keepPreviousData,
  });

  const totalPages = itemsQuery.data ? Math.max(1, Math.ceil(itemsQuery.data.total / pageSize)) : 1;

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const params = buildQueryParams(stage, ownerRoleFilter, filters, sortBy, sortDir, page, pageSize);
      params.delete('page');
      params.delete('page_size');
      const { blob, filename } = await api.getBlob(`/pending-items/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const rolePrefix = ownerRoleFilter !== 'ALL' ? `${ownerRoleFilter}_` : 'All_';
      link.download = filename ?? `${stage.replace(/\s+/g, '_')}_${rolePrefix}Pending_Ageing.xlsx`;
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

  const hasAnyActiveFilter =
    filters.search !== '' ||
    filters.vesselName.length > 0 ||
    filters.ownerName.length > 0 ||
    filters.ageingBracket !== '';

  function sortIndicator(column: SortColumn) {
    if (sortBy !== column) return null;
    return <span className="sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const breakdownData = breakdownQuery.data;
  const filteredOwners = (breakdownData?.owners ?? []).filter((o) => {
    if (ownerRoleFilter === 'ALL') return true;
    return o.ownerRole === ownerRoleFilter;
  });

  const totalForCurrentStage = stageTotal(stage);
  const tsiForCurrentStage = countFor(stage, 'TSI');
  const taForCurrentStage = countFor(stage, 'TA');

  const activeRoleLabel =
    ownerRoleFilter === 'ALL'
      ? 'All Roles'
      : ownerRoleFilter === 'TSI'
        ? 'TSI Pending'
        : 'TA Pending';

  return (
    <div className="tracker-page pending-items-page">
      <div className="tracker-page-header">
        <div className="tracker-page-header-left">
          <h1 className="tracker-page-title">
            {activeView === 'dashboard' ? 'TSI / TA Pending Dashboard' : 'TSI / TA Pending Items'}
          </h1>
          <div className="tracker-view-tabs">
            <button
              type="button"
              className={`tracker-view-tab ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`tracker-view-tab ${activeView === 'items' ? 'active' : ''}`}
              onClick={() => setActiveView('items')}
            >
              Detailed Items
            </button>
          </div>
        </div>

        {activeView === 'items' && (
          <div className="tracker-page-count">
            <span className="count-number">{itemsQuery.data?.total ?? 0}</span>
            <span className="count-label">{stage} · {activeRoleLabel}</span>
          </div>
        )}
      </div>

      {activeView === 'dashboard' ? (
        <PendingDashboardPage onDrillDown={handleDrillDown} />
      ) : (
        <>
          {/* Top stage tabs */}
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

      {/* Sub-tabs row: All Pending / TSI Pending / TA Pending */}
      <div className="pending-subnav-row">
        <div className="pending-role-pills">
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-all ${ownerRoleFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('ALL')}
          >
            All Pending
            <span className="pending-role-pill-count">{totalForCurrentStage}</span>
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-tsi ${ownerRoleFilter === 'TSI' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('TSI')}
          >
            TSI Pending
            <span className="pending-role-pill-count">{tsiForCurrentStage}</span>
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-ta ${ownerRoleFilter === 'TA' ? 'active' : ''}`}
            onClick={() => selectRoleFilter('TA')}
          >
            TA Pending
            <span className="pending-role-pill-count">{taForCurrentStage}</span>
          </button>
        </div>

        <div className="pending-breakdown-meta">
          <span className="pending-breakdown-hint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Click any owner or vessel to filter
          </span>
          <button
            type="button"
            className="pending-breakdown-toggle-btn"
            onClick={() => setShowBreakdown((prev) => !prev)}
          >
            <span>{showBreakdown ? '▲ Hide Breakdown' : '▼ Show Breakdown'}</span>
          </button>
        </div>
      </div>

      {/* Dashboard style breakdown cards */}
      {showBreakdown && (
        <div className="pending-breakdown-wrapper">
          <div className="pending-cards-grid">
            {filteredOwners.map((owner) => {
              const isOwnerActive = filters.ownerName.includes(owner.ownerName);
              const isTsi = owner.ownerRole === 'TSI';

              return (
                <div
                  key={`${owner.ownerName}-${owner.ownerRole}`}
                  className={`pending-owner-card ${isOwnerActive ? 'active' : ''}`}
                  onClick={() => {
                    if (isOwnerActive) {
                      updateFilters({ ownerName: [] });
                    } else {
                      updateFilters({ ownerName: [owner.ownerName] });
                    }
                  }}
                >
                  <div className="pending-card-header">
                    <div className="pending-card-header-left">
                      <div className={`pending-card-avatar ${isTsi ? 'pending-card-avatar-tsi' : 'pending-card-avatar-ta'}`}>
                        {getInitials(owner.ownerName)}
                      </div>
                      <span className="pending-card-owner-name">{owner.ownerName}</span>
                      <span className={`pending-card-role-chip ${isTsi ? 'pending-card-role-chip-tsi' : 'pending-card-role-chip-ta'}`}>
                        {owner.ownerRole}
                      </span>
                    </div>

                    <div className="pending-card-header-right">
                      {isOwnerActive ? (
                        <span className="pending-card-active-pill">
                          Active <span className="pending-card-active-count">{owner.totalCount}</span>
                        </span>
                      ) : (
                        <span className="pending-card-count">{owner.totalCount}</span>
                      )}
                    </div>
                  </div>

                  <div className="pending-card-vessels">
                    {owner.vessels.map((v) => {
                      const isVesselActive = filters.vesselName.includes(v.vesselName);
                      return (
                        <button
                          key={v.vesselName}
                          type="button"
                          className={`pending-vessel-chip ${isVesselActive ? 'active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isVesselActive) {
                              updateFilters({ vesselName: [] });
                            } else {
                              updateFilters({ vesselName: [v.vesselName] });
                            }
                          }}
                        >
                          <span>{v.vesselName}</span>
                          <span className="pending-vessel-chip-count">{v.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder={
              stage === 'Requisition'
                ? 'Search PR no., vessel, title, owner…'
                : stage === 'Purchase Order'
                  ? 'Search PO no., vessel, vendor, title, owner…'
                  : 'Search invoice no., vessel, vendor, owner…'
            }
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
          />
        </div>

        <Dropdown
          label="All vessels"
          value={filters.vesselName[0] || ''}
          options={vesselOptions}
          onChange={(val) => updateFilters({ vesselName: val ? [val] : [] })}
        />

        <Dropdown
          label="All owners"
          value={filters.ownerName[0] || ''}
          options={ownerNameOptions}
          onChange={(val) => updateFilters({ ownerName: val ? [val] : [] })}
        />

        <Dropdown
          label="All Ageing"
          value={filters.ageingBracket}
          options={AGEING_OPTIONS}
          onChange={(val) => updateFilters({ ageingBracket: val })}
        />

        <div className="tracker-toolbar-spacer" />

        <button
          className="btn-tracker-action btn-tracker-secondary"
          onClick={handleExport}
          disabled={isExporting}
          title={`Export ${stage} (${activeRoleLabel}) ageing matrix with clickable drill-down detail sheets to Excel`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {isExporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {/* Active filters bar */}
      {hasAnyActiveFilter && (
        <div className="pending-active-filters-bar">
          <span className="pending-active-filters-label">Active Filters:</span>

          {filters.search && (
            <span className="pending-filter-chip">
              Search: &quot;{filters.search}&quot;
              <button
                type="button"
                className="pending-filter-chip-remove"
                onClick={() => updateFilters({ search: '' })}
              >
                ✕
              </button>
            </span>
          )}

          {filters.vesselName.map((v) => (
            <span key={v} className="pending-filter-chip">
              Vessel: {v}
              <button
                type="button"
                className="pending-filter-chip-remove"
                onClick={() => updateFilters({ vesselName: filters.vesselName.filter((x) => x !== v) })}
              >
                ✕
              </button>
            </span>
          ))}

          {filters.ownerName.map((o) => (
            <span key={o} className="pending-filter-chip">
              Owner: {o}
              <button
                type="button"
                className="pending-filter-chip-remove"
                onClick={() => updateFilters({ ownerName: filters.ownerName.filter((x) => x !== o) })}
              >
                ✕
              </button>
            </span>
          ))}

          {filters.ageingBracket && (
            <span className="pending-filter-chip">
              Ageing: {filters.ageingBracket}
              <button
                type="button"
                className="pending-filter-chip-remove"
                onClick={() => updateFilters({ ageingBracket: '' })}
              >
                ✕
              </button>
            </span>
          )}

          <button type="button" className="pending-reset-all-btn" onClick={clearAllFilters}>
            Reset all
          </button>
        </div>
      )}

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
                {stage === 'Requisition' ? (
                  <>
                    <colgroup>
                      <col style={{ width: 180 }} />
                      <col style={{ width: 250 }} />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 120 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('referenceNo')}>PR Reference No. {sortIndicator('referenceNo')}</th>
                        <th onClick={() => handleSort('title')}>Title / Description {sortIndicator('title')}</th>
                        <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                        <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                        <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                        <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                        <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(itemsQuery.data?.items ?? []).map((item, idx) => (
                        <tr key={`${item.referenceNo}-${idx}`}>
                          <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                          <td className="pr-title-cell" title={item.title ?? ''}>{item.title ?? '—'}</td>
                          <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                          <td>{renderStatusPill(stage, item.status, item.ownerRole)}</td>
                          <td className="owner-cell">
                            <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : 'role-ta'}`}>{item.ownerRole}</span>
                            {item.ownerName ?? '—'}
                          </td>
                          <td>
                            <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                              {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                            </span>
                          </td>
                          <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                        </tr>
                      ))}
                      {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="pending-items-empty">
                            No requisition items match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                ) : stage === 'Purchase Order' ? (
                  <>
                    <colgroup>
                      <col style={{ width: 170 }} />
                      <col style={{ width: 220 }} />
                      <col style={{ width: 150 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 100 }} />
                      <col style={{ width: 110 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('referenceNo')}>PO Number {sortIndicator('referenceNo')}</th>
                        <th onClick={() => handleSort('title')}>Title / Description {sortIndicator('title')}</th>
                        <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                        <th onClick={() => handleSort('vendor')}>Vendor {sortIndicator('vendor')}</th>
                        <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                        <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                        <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                        <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(itemsQuery.data?.items ?? []).map((item, idx) => (
                        <tr key={`${item.referenceNo}-${idx}`}>
                          <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                          <td className="pr-title-cell" title={item.title ?? ''}>{item.title ?? '—'}</td>
                          <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                          <td>{item.vendor ?? '—'}</td>
                          <td>{renderStatusPill(stage, item.status, item.ownerRole)}</td>
                          <td className="owner-cell">
                            <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : 'role-ta'}`}>{item.ownerRole}</span>
                            {item.ownerName ?? '—'}
                          </td>
                          <td>
                            <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                              {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                            </span>
                          </td>
                          <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                        </tr>
                      ))}
                      {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                        <tr>
                          <td colSpan={8} className="pending-items-empty">
                            No purchase orders match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                ) : (
                  <>
                    <colgroup>
                      <col style={{ width: 180 }} />
                      <col style={{ width: 160 }} />
                      <col style={{ width: 220 }} />
                      <col style={{ width: 140 }} />
                      <col style={{ width: 130 }} />
                      <col style={{ width: 100 }} />
                      <col style={{ width: 110 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th onClick={() => handleSort('referenceNo')}>Invoice No. {sortIndicator('referenceNo')}</th>
                        <th onClick={() => handleSort('vesselName')}>Vessel {sortIndicator('vesselName')}</th>
                        <th onClick={() => handleSort('vendor')}>Vendor {sortIndicator('vendor')}</th>
                        <th onClick={() => handleSort('status')}>Status {sortIndicator('status')}</th>
                        <th onClick={() => handleSort('ownerName')}>Owner {sortIndicator('ownerName')}</th>
                        <th onClick={() => handleSort('ageingDays')}>Ageing {sortIndicator('ageingDays')}</th>
                        <th onClick={() => handleSort('referenceDate')}>Date {sortIndicator('referenceDate')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(itemsQuery.data?.items ?? []).map((item, idx) => (
                        <tr key={`${item.referenceNo}-${idx}`}>
                          <td className="pr-reference-no-cell">{item.referenceNo ?? '—'}</td>
                          <td className="vessel-name-cell">{item.vesselName ?? '—'}</td>
                          <td>{item.vendor ?? '—'}</td>
                          <td>{renderStatusPill(stage, item.status, item.ownerRole)}</td>
                          <td className="owner-cell">
                            <span className={`owner-role-badge-text ${item.ownerRole === 'TSI' ? 'role-tsi' : 'role-ta'}`}>{item.ownerRole}</span>
                            {item.ownerName ?? '—'}
                          </td>
                          <td>
                            <span className={`ageing-chip ${getAgeingClass(item.ageingDays)}`}>
                              {item.ageingDays !== null ? `${item.ageingDays}d` : '—'}
                            </span>
                          </td>
                          <td className="date-cell">{formatDisplayDate(item.referenceDate)}</td>
                        </tr>
                      ))}
                      {itemsQuery.data && itemsQuery.data.items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="pending-items-empty">
                            No invoices match the current filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </>
                )}
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
        </>
      )}
    </div>
  );
}
