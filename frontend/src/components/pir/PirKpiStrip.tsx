import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { PirKpis } from '../../shared';

// Fixed palette for the currency-mix stacked bar — cycles if there are ever more currencies
// than colors (today's real data tops out at 9 distinct currency codes).
const CURRENCY_COLORS = [
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-primary)',
  '#7c3aed',
  '#0d9488',
  '#db2777',
  '#65a30d',
];

export function PirKpiStrip() {
  // Deliberately its own query, independent of PIRPage's department-tab/search filters — same
  // "always global" convention as Dashboard's KpiGrid relative to TrackerPage's toolbar state.
  const kpisQuery = useQuery({
    queryKey: ['pir-kpis'],
    queryFn: () => api.get<PirKpis>('/pir-entries/kpis'),
  });

  if (!kpisQuery.data) return null;
  const kpis = kpisQuery.data;

  return (
    <div className="kpi-row pir-kpi-row">
      {/* 1. Total Open */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: '#0ea5e9' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'rgba(14,165,233,0.1)', color: '#0ea5e9' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">{kpis.totalOpen}</div>
          <div className="kpi-label-premium">
            Total Open · {kpis.byDepartment.technical} Tech · {kpis.byDepartment.manning} Manning
          </div>
        </div>
      </div>

      {/* 2. Needs Triage */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: '#ef4444' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">{kpis.needsTriageCount}</div>
          <div className="kpi-label-premium">Needs Triage (no vessel)</div>
        </div>
      </div>

      {/* 3. Oldest Open */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: '#f59e0b' }}></div>
        <div className="kpi-icon-glass" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div className="kpi-content">
          <div className="kpi-value-premium">{kpis.oldestInvoice ? `${kpis.oldestInvoice.ageDays}d` : '—'}</div>
          <div className="kpi-label-premium">
            Oldest Open · {kpis.oldestInvoice?.vesselGroup ?? '—'}
          </div>
        </div>
      </div>

      {/* 4. Currency Mix */}
      <div className="kpi-card-premium">
        <div className="kpi-accent-bar" style={{ background: '#10b981' }}></div>
        <div className="kpi-content" style={{ width: '100%' }}>
          <div className="kpi-value-premium" style={{ fontSize: 18 }}>Currency Mix</div>
          
          <div className="pir-kpi-bar-container" style={{ margin: '6px 0' }}>
            {kpis.currencyMix.map((c, i) => (
              <div
                key={c.currencyCode}
                className="pir-kpi-bar-segment"
                style={{ width: `${c.percentage}%`, background: CURRENCY_COLORS[i % CURRENCY_COLORS.length] }}
                title={`${c.currencyCode}: ${c.count} (${c.percentage}%)`}
              />
            ))}
          </div>

          <div className="kpi-label-premium">
            {kpis.currencyMix
              .slice(0, 3)
              .map((c) => `${c.currencyCode} ${c.percentage}%`)
              .join(' · ')}
            {kpis.currencyMix.length > 3 && ` +${kpis.currencyMix.length - 3} more`}
          </div>
        </div>
      </div>
    </div>
  );
}
