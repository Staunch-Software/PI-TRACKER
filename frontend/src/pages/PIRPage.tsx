import { useEffect, useMemo, useState } from 'react';
import './PIR.css';
import '../pages/Dashboard.css';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRole } from '../auth/useRole';
import { api } from '../lib/api';
import type { PaginatedResult, PirDepartment, PirDepartmentCounts, PirEntry, Vessel } from '../shared';
import { PirKpiStrip } from '../components/pir/PirKpiStrip';
import { UserActivityButton } from '../components/pir/UserActivityButton';
import { PirVesselSidebar, NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP, type SidebarBucket } from '../components/pir/PirVesselSidebar';
import {
  PirInvoiceTable,
  DEFAULT_PIR_COLUMN_ORDER,
  DEFAULT_PIR_COL_WIDTHS,
  EMPTY_PIR_COLUMN_FILTERS,
  type PirColumnFilters,
  type PirColumnKey,
} from '../components/pir/PirInvoiceTable';

type Tab = PirDepartment | 'ALL';
type ResolvedFilter = 'OPEN' | 'RESOLVED' | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TECHNICAL', label: 'Technical' },
  { key: 'MANNING', label: 'Manning' },
  { key: 'UNCLASSIFIED', label: 'Unclassified' },
];

const RESOLVED_FILTERS: { key: ResolvedFilter; label: string }[] = [
  { key: 'OPEN', label: 'Open (Needs Triage)' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'ALL', label: 'All History' },
];

const FETCH_ALL_PAGE_SIZE = 10000;

interface TableLayoutPreference {
  tableKey: string;
  columnOrder: string[];
  columnWidths: Record<string, number>;
}

function sanitizeColumnOrder(saved: string[] | null | undefined): PirColumnKey[] {
  const known = new Set<string>(DEFAULT_PIR_COLUMN_ORDER);
  const filtered = (saved ?? []).filter((k): k is PirColumnKey => known.has(k));
  const missing = DEFAULT_PIR_COLUMN_ORDER.filter((k) => !filtered.includes(k));
  return [...filtered, ...missing];
}

function sanitizeColumnWidths(saved: Record<string, number> | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(DEFAULT_PIR_COL_WIDTHS) as PirColumnKey[]) {
    const w = saved?.[key];
    result[key] = typeof w === 'number' && w >= 60 && w <= 1000 ? w : DEFAULT_PIR_COL_WIDTHS[key];
  }
  return result;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

function today(): string {
  return isoDate(new Date());
}

export function PIRPage() {
  const [tab, setTab] = useState<Tab>('ALL');
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>('OPEN');
  const [search, setSearch] = useState('');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [resolvedDateFrom, setResolvedDateFrom] = useState(yesterday());
  const [resolvedDateTo, setResolvedDateTo] = useState(today());

  const [columnFilters, setColumnFilters] = useState<PirColumnFilters>(EMPTY_PIR_COLUMN_FILTERS);

  const { canEdit } = useRole();
  const [layoutEditable, setLayoutEditable] = useState(false);
  const [savedColumnOrder, setSavedColumnOrder] = useState<PirColumnKey[]>([...DEFAULT_PIR_COLUMN_ORDER]);
  const [savedColumnWidths, setSavedColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_PIR_COL_WIDTHS });
  const [columnOrder, setColumnOrder] = useState<PirColumnKey[]>([...DEFAULT_PIR_COLUMN_ORDER]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({ ...DEFAULT_PIR_COL_WIDTHS });

  const countsQuery = useQuery({
    queryKey: ['pir-department-counts'],
    queryFn: () => api.get<PirDepartmentCounts>('/pir-entries/department-counts'),
  });

  const entriesQuery = useQuery({
    queryKey: ['pir-entries', tab, resolvedFilter, search, resolvedFilter === 'RESOLVED' ? resolvedDateFrom : null, resolvedFilter === 'RESOLVED' ? resolvedDateTo : null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tab !== 'ALL') params.set('department', tab);
      params.set('resolved', resolvedFilter);
      if (search) params.set('search', search);
      if (resolvedFilter === 'RESOLVED') {
        if (resolvedDateFrom) params.set('resolved_date_from', resolvedDateFrom);
        if (resolvedDateTo) params.set('resolved_date_to', resolvedDateTo);
      }
      params.set('page', '1');
      params.set('page_size', String(FETCH_ALL_PAGE_SIZE));
      return api.get<PaginatedResult<PirEntry>>(`/pir-entries?${params.toString()}`);
    },
  });

  const vesselsQuery = useQuery({ queryKey: ['vessels'], queryFn: () => api.get<Vessel[]>('/vessels') });

  const tableLayoutQuery = useQuery({
    queryKey: ['table-layout', 'pir_entries'],
    queryFn: () => api.get<TableLayoutPreference | null>('/table-layout/pir_entries'),
  });

  useEffect(() => {
    if (tableLayoutQuery.data === undefined) return;
    const order = sanitizeColumnOrder(tableLayoutQuery.data?.columnOrder);
    const widths = sanitizeColumnWidths(tableLayoutQuery.data?.columnWidths);
    setSavedColumnOrder(order);
    setSavedColumnWidths(widths);
    setColumnOrder(order);
    setColumnWidths(widths);
  }, [tableLayoutQuery.data]);

  const saveLayoutMutation = useMutation({
    mutationFn: () => api.put<TableLayoutPreference>('/table-layout/pir_entries', { columnOrder, columnWidths }),
    onSuccess: () => {
      setSavedColumnOrder(columnOrder);
      setSavedColumnWidths(columnWidths);
      setLayoutEditable(false);
    },
  });

  function cancelLayoutEdit() {
    setColumnOrder(savedColumnOrder);
    setColumnWidths(savedColumnWidths);
    setLayoutEditable(false);
  }

  const itemsByBucket = useMemo(() => {
    const map = new Map<string, PirEntry[]>();
    for (const item of entriesQuery.data?.items ?? []) {
      const bucket = map.get(item.vesselGroup);
      if (bucket) bucket.push(item);
      else map.set(item.vesselGroup, [item]);
    }
    return map;
  }, [entriesQuery.data]);

  const buckets: SidebarBucket[] = useMemo(
    () => Array.from(itemsByBucket.entries()).map(([vesselGroup, items]) => ({ vesselGroup, count: items.length })),
    [itemsByBucket]
  );

  useEffect(() => {
    if (selectedBucket && itemsByBucket.has(selectedBucket)) return;
    const triage = buckets
      .filter((b) => b.vesselGroup === NO_VESSEL_GROUP || b.vesselGroup === UNMATCHED_VESSEL_GROUP)
      .sort((a, b) => b.count - a.count)[0];
    const fleet = buckets
      .filter((b) => b.vesselGroup !== NO_VESSEL_GROUP && b.vesselGroup !== UNMATCHED_VESSEL_GROUP)
      .sort((a, b) => b.count - a.count)[0];
    setSelectedBucket((triage ?? fleet)?.vesselGroup ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, itemsByBucket]);

  return (
    <div className="dash-page pir-page">
      
      {/* ── HEADER ── */}
      <div className="dash-header">
        <div className="dash-header-left">
          <p className="dash-greeting">PIR Tracker</p>
          <h1 className="dash-title">Problematic Invoice Resolution</h1>
          <p className="dash-subtitle">
            {entriesQuery.data
              ? `${entriesQuery.data.total} invoice${entriesQuery.data.total === 1 ? '' : 's'}`
              : 'Loading…'}
            {' — scraped from SmartPAL, classified by vendor'}
          </p>
        </div>
        <UserActivityButton />
      </div>

      <PirKpiStrip />

      {/* ── CONTROLS (TABS + FILTERS) ── */}
      <div className="pir-controls">
        
        {/* Department Tabs */}
        <div className="pir-tabs-container">
          <div className="pir-tabs-premium">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`pir-tab-premium${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {countsQuery.data && (
                  <span className="pir-tab-count">
                    {t.key === 'ALL'
                      ? countsQuery.data.all
                      : countsQuery.data[t.key.toLowerCase() as 'technical' | 'manning' | 'unclassified']}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Resolved Tabs */}
        <div className="pir-tabs-container">
          <div className="pir-tabs-premium">
            {RESOLVED_FILTERS.map((f) => (
              <button
                key={f.key}
                className={`pir-tab-premium${resolvedFilter === f.key ? ' active' : ''}`}
                onClick={() => setResolvedFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="pir-filters">
          <div className="pir-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="search"
              placeholder="Search invoice no., vendor, vessel, PO…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {canEdit && (
            layoutEditable ? (
              <div className="pir-layout-edit-group">
                <button
                  type="button"
                  className="pir-layout-btn pir-layout-btn-success"
                  onClick={() => saveLayoutMutation.mutate()}
                  disabled={saveLayoutMutation.isPending}
                >
                  {saveLayoutMutation.isPending ? 'Saving…' : 'Save Layout'}
                </button>
                <button type="button" className="pir-layout-btn" onClick={cancelLayoutEdit}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="pir-layout-btn" onClick={() => setLayoutEditable(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                Edit Layout
              </button>
            )
          )}
        </div>

        {resolvedFilter === 'RESOLVED' && (
          <div className="pir-filters pir-date-filters">
            <div className="pir-date-filter">
              <label>From</label>
              <input type="date" value={resolvedDateFrom} onChange={(e) => setResolvedDateFrom(e.target.value)} />
            </div>
            <div className="pir-date-filter">
              <label>To</label>
              <input type="date" value={resolvedDateTo} onChange={(e) => setResolvedDateTo(e.target.value)} />
            </div>
          </div>
        )}

      </div>

      <p className="pir-record-count">
        {entriesQuery.data ? `${entriesQuery.data.total} record${entriesQuery.data.total === 1 ? '' : 's'} found` : 'Loading…'}
      </p>

      {entriesQuery.data && buckets.length === 0 && (
        <div className="card pir-empty-card">
          No problematic invoices match this filter.
        </div>
      )}

      {buckets.length > 0 && (
        <div className="pir-split">
          <PirVesselSidebar buckets={buckets} selected={selectedBucket} onSelect={setSelectedBucket} />
          {selectedBucket && (
            <PirInvoiceTable
              // Remounts (resetting bulk-select/optimistic-removal state) whenever the selected
              // bucket changes — see PirInvoiceTable.tsx's own comment on why that's the right
              // reset mechanism here instead of an effect.
              key={selectedBucket}
              vesselGroup={selectedBucket}
              items={itemsByBucket.get(selectedBucket) ?? []}
              vessels={vesselsQuery.data ?? []}
              columnOrder={columnOrder}
              columnWidths={columnWidths}
              layoutEditable={layoutEditable}
              onReorderColumn={setColumnOrder}
              onResizeColumn={(key, width) => setColumnWidths((prev) => ({ ...prev, [key]: width }))}
              columnFilters={columnFilters}
              onColumnFiltersChange={setColumnFilters}
            />
          )}
        </div>
      )}
    </div>
  );
}