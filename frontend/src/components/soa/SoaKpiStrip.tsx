import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatAmount } from '../../lib/format';
import type { SoaKpis } from '../../shared';

export function SoaKpiStrip() {
  // Deliberately its own query, independent of SOAPage's search/match-source filters — same
  // "always global" convention as PirKpiStrip relative to PIRPage's own filter state.
  const kpisQuery = useQuery({
    queryKey: ['soa-kpis'],
    queryFn: () => api.get<SoaKpis>('/soa-entries/kpis'),
  });

  if (!kpisQuery.data) return null;
  const kpis = kpisQuery.data;
  const currencyEntries = Object.entries(kpis.totalOutstandingByCurrency);

  return (
    <div className="kpi-row pir-kpi-row">
      {/* 1. Total Line Items */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: 'var(--color-info)' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">{kpis.totalLineItems}</div>
          <div className="kpi-label-premium">
            Total SOA Line Items · Across {kpis.totalVendors} vendor{kpis.totalVendors === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* 2. Needs Triage */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: 'var(--color-danger)' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">{kpis.needsTriageCount}</div>
          <div className="kpi-label-premium">No Match — Needs Triage</div>
        </div>
      </div>

      {/* 3. By Source */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: 'var(--color-neutral)' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">By Source</div>
          <div className="kpi-label-premium soa-kpi-label-wrap">
            SmartPAL {kpis.byMatchSource.smartpal} · PIR {kpis.byMatchSource.pir} · Mail {kpis.byMatchSource.invoiceMail} · No Match {kpis.byMatchSource.none}
          </div>
        </div>
      </div>

      {/* 4. Outstanding */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: 'var(--color-warning)' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">Outstanding</div>
          <div className="kpi-label-premium soa-kpi-label-wrap">
            {currencyEntries.length
              ? currencyEntries.map(([code, amount]) => `${code} ${formatAmount(amount)}`).join(' · ')
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
