import { useEffect, useMemo, useState } from 'react';
import './PIR.css';
import '../pages/Dashboard.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PaginatedResult, PirDepartment, PirDepartmentCounts, PirEntry, Vessel } from '../shared';
import { PirKpiStrip } from '../components/pir/PirKpiStrip';
import { PirVesselSidebar, NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP, type SidebarBucket } from '../components/pir/PirVesselSidebar';
import { PirInvoiceTable } from '../components/pir/PirInvoiceTable';

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
    <div className="dash-page" style={{ height: 'calc(100vh - 108px)' }}>
      
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
        </div>

        {resolvedFilter === 'RESOLVED' && (
          <div className="pir-filters" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="date-range-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Resolved From</label>
              <input type="date" value={resolvedDateFrom} onChange={(e) => setResolvedDateFrom(e.target.value)} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--color-border)' }} />
            </div>
            <div className="date-range-field" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Resolved To</label>
              <input type="date" value={resolvedDateTo} onChange={(e) => setResolvedDateTo(e.target.value)} style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--color-border)' }} />
            </div>
          </div>
        )}

      </div>

      {entriesQuery.data && buckets.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
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
            />
          )}
        </div>
      )}
    </div>
  );
}
