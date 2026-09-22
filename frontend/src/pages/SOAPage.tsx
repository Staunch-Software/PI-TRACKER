import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SoaMatchSource, type PaginatedResult, type SoaLineItem, type SoaRematchResult } from '../shared';
import { SearchIcon } from '../components/common/SearchIcon';
import { useRole } from '../auth/useRole';
import { SoaKpiStrip } from '../components/soa/SoaKpiStrip';
import { SoaVendorTable } from '../components/soa/SoaVendorTable';

type MatchFilter = SoaMatchSource | 'ALL';

const FILTER_TABS: { key: MatchFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: SoaMatchSource.NONE, label: 'Needs Triage' },
  { key: SoaMatchSource.SMARTPAL, label: 'SmartPAL' },
  { key: SoaMatchSource.PIR, label: 'PIR' },
  { key: SoaMatchSource.INVOICE_MAIL, label: 'Invoice Mail Only' },
];

// Well above realistic current volume — this page has no per-row UI pagination yet (matches
// PIRPage's FETCH_ALL_PAGE_SIZE convention), so the table just shows everything matching the
// current filter in one response.
const FETCH_ALL_PAGE_SIZE = 5000;

export function SOAPage() {
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('ALL');
  const [search, setSearch] = useState('');
  const { canEdit } = useRole();
  const queryClient = useQueryClient();

  const entriesQuery = useQuery({
    queryKey: ['soa-entries', matchFilter, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (matchFilter !== 'ALL') params.set('match_source', matchFilter);
      if (search) params.set('search', search);
      params.set('page', '1');
      params.set('page_size', String(FETCH_ALL_PAGE_SIZE));
      return api.get<PaginatedResult<SoaLineItem>>(`/soa-entries?${params.toString()}`);
    },
  });

  const rematchMutation = useMutation({
    mutationFn: () => api.post<SoaRematchResult>('/soa-entries/rematch', {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['soa-entries'] });
      queryClient.invalidateQueries({ queryKey: ['soa-kpis'] });
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>SOA Reconciliation</h1>
          <p>
            {entriesQuery.data
              ? `${entriesQuery.data.total} line item${entriesQuery.data.total === 1 ? '' : 's'}`
              : 'Loading…'}
            {' — vendor Statements of Account, cross-checked against SmartPAL, PIR, and invoice mail'}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => rematchMutation.mutate()}
            disabled={rematchMutation.isPending}
          >
            {rematchMutation.isPending ? 'Rematching…' : 'Rematch Now'}
          </button>
        )}
      </div>

      <SoaKpiStrip />

      <div className="toolbar">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`filter-chip${matchFilter === t.key ? ' active' : ''}`}
            onClick={() => setMatchFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="toolbar-row" style={{ marginBottom: 14 }}>
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search invoice no., vendor, vessel…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <SoaVendorTable items={entriesQuery.data?.items ?? []} />
      </div>
    </div>
  );
}
