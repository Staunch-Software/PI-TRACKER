import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SoaMatchSource, type PaginatedResult, type SoaLineItem, type SoaRematchResult } from '../shared';
import { SearchIcon } from '../components/common/SearchIcon';
import { useRole } from '../auth/useRole';
import { SoaKpiStrip } from '../components/soa/SoaKpiStrip';
import { SoaVendorTable } from '../components/soa/SoaVendorTable';
import './SOA.css';

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
    <div className="dash-page soa-page">
      {/* ── HEADER ── */}
      <div className="dash-header">
        <div className="dash-header-left">
          <div className="dash-greeting">SOA TRACKER</div>
          <h1 className="dash-title">Statement of Account Reconciliation</h1>
          <p className="dash-subtitle">
            {entriesQuery.data
              ? `${entriesQuery.data.total} line item${entriesQuery.data.total === 1 ? '' : 's'}`
              : 'Loading…'}
            {' — vendor Statements of Account, cross-checked against SmartPAL, PIR, and invoice mail'}
          </p>
        </div>
        
        {canEdit && (
          <button
            type="button"
            className="soa-btn-primary"
            onClick={() => rematchMutation.mutate()}
            disabled={rematchMutation.isPending}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: rematchMutation.isPending ? 'spin 1s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            {rematchMutation.isPending ? 'Rematching…' : 'Rematch Now'}
          </button>
        )}
      </div>

      <SoaKpiStrip />

      {/* ── CONTROLS & TABLE SPLIT (or unified panel) ── */}
      {/* For SOA we don't have a sidebar, just a full-width table under controls */}
      <div className="dash-panel pir-content-pane soa-content-pane">
        
        <div className="pir-controls">
          <div className="soa-filter-container">
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`soa-filter-chip${matchFilter === t.key ? ' active' : ''}`}
                onClick={() => setMatchFilter(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="pir-filters">
            <div className="pir-search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search invoice no., vendor, vessel…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <SoaVendorTable items={entriesQuery.data?.items ?? []} />
      </div>
    </div>
  );
}
