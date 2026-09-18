import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PaginatedResult, PirDepartment, PirDepartmentCounts, PirEntry, Vessel } from '../shared';
import { SearchIcon } from '../components/common/SearchIcon';
import { PirKpiStrip } from '../components/pir/PirKpiStrip';
import { PirVesselSidebar, NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP, type SidebarBucket } from '../components/pir/PirVesselSidebar';
import { PirInvoiceTable } from '../components/pir/PirInvoiceTable';

type Tab = PirDepartment | 'ALL';

const TABS: { key: Tab; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TECHNICAL', label: 'Technical' },
  { key: 'MANNING', label: 'Manning' },
  { key: 'UNCLASSIFIED', label: 'Unclassified' },
];

// Well above today's ~1900-row total — the split-view needs the full matching set in one
// response to build accurate sidebar bucket counts, same reasoning as the old accordion layout.
const FETCH_ALL_PAGE_SIZE = 10000;

export function PIRPage() {
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);

  const countsQuery = useQuery({
    queryKey: ['pir-department-counts'],
    queryFn: () => api.get<PirDepartmentCounts>('/pir-entries/department-counts'),
  });

  const entriesQuery = useQuery({
    queryKey: ['pir-entries', tab, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (tab !== 'ALL') params.set('department', tab);
      if (search) params.set('search', search);
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

  // Default selection: prefer the largest "needs triage" bucket (the thing most worth looking
  // at first) if one has items, otherwise the largest real vessel bucket. Re-picks whenever the
  // current selection disappears from the bucket list (e.g. a department-tab/search change, or
  // the last row in a bucket just got assigned away) rather than leaving the right pane stuck
  // showing a bucket that no longer exists.
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
    <div>
      <div className="page-header">
        <div>
          <h1>Problematic Invoice Resolution</h1>
          <p>
            {entriesQuery.data
              ? `${entriesQuery.data.total} invoice${entriesQuery.data.total === 1 ? '' : 's'}`
              : 'Loading…'}
            {' — scraped from SmartPAL, classified by vendor'}
          </p>
        </div>
      </div>

      <PirKpiStrip />

      <div className="toolbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-chip${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {countsQuery.data &&
              ` (${
                t.key === 'ALL'
                  ? countsQuery.data.all
                  : countsQuery.data[t.key.toLowerCase() as 'technical' | 'manning' | 'unclassified']
              })`}
          </button>
        ))}
      </div>

      <div className="toolbar-row" style={{ marginBottom: 14 }}>
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search invoice no., vendor, vessel, PO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
