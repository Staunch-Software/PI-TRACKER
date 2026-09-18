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
    <div className="kpi-grid-4">
      <div className="kpi-card" style={{ background: 'var(--color-info-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-info)' }}>
          {kpis.totalOpen}
        </div>
        <div className="kpi-label">
          Total Open Invoices
          <div style={{ marginTop: 4, fontWeight: 400, color: 'var(--color-text-muted)' }}>
            {kpis.byDepartment.technical} Technical · {kpis.byDepartment.manning} Manning ·{' '}
            {kpis.byDepartment.unclassified} Unclassified
          </div>
        </div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-danger-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-danger)' }}>
          {kpis.needsTriageCount}
        </div>
        <div className="kpi-label">Needs Triage (no vessel / not in fleet)</div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-warning-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-warning)' }}>
          {kpis.oldestInvoice ? `${kpis.oldestInvoice.ageDays}d` : '—'}
        </div>
        <div className="kpi-label">
          Oldest Open Invoice
          {kpis.oldestInvoice && (
            <div style={{ marginTop: 4, fontWeight: 400, color: 'var(--color-text-muted)' }}>
              {kpis.oldestInvoice.invoiceNo ?? '—'} · {kpis.oldestInvoice.vesselGroup}
            </div>
          )}
        </div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-neutral-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-neutral)', fontSize: 20 }}>
          Currency Mix
        </div>
        <div className="currency-mix-bar">
          {kpis.currencyMix.map((c, i) => (
            <div
              key={c.currencyCode}
              style={{ width: `${c.percentage}%`, background: CURRENCY_COLORS[i % CURRENCY_COLORS.length] }}
              title={`${c.currencyCode}: ${c.count} (${c.percentage}%)`}
            />
          ))}
        </div>
        <div className="kpi-label" style={{ marginTop: 8 }}>
          {kpis.currencyMix
            .slice(0, 3)
            .map((c) => `${c.currencyCode} ${c.percentage}%`)
            .join(' · ')}
          {kpis.currencyMix.length > 3 && ` +${kpis.currencyMix.length - 3} more`}
        </div>
      </div>
    </div>
  );
}
