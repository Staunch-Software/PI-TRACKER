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
    <div className="kpi-grid-4">
      <div className="kpi-card" style={{ background: 'var(--color-info-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-info)' }}>
          {kpis.totalLineItems}
        </div>
        <div className="kpi-label">
          Total SOA Line Items
          <div style={{ marginTop: 4, fontWeight: 400, color: 'var(--color-text-muted)' }}>
            Across {kpis.totalVendors} vendor{kpis.totalVendors === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-danger-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-danger)' }}>
          {kpis.needsTriageCount}
        </div>
        <div className="kpi-label">No Match — Needs Triage</div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-neutral-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-neutral)', fontSize: 20 }}>
          By Source
        </div>
        <div className="kpi-label" style={{ marginTop: 4 }}>
          SmartPAL {kpis.byMatchSource.smartpal} · PIR {kpis.byMatchSource.pir} · Invoice Mail{' '}
          {kpis.byMatchSource.invoiceMail} · No Match {kpis.byMatchSource.none}
        </div>
      </div>

      <div className="kpi-card" style={{ background: 'var(--color-warning-bg)' }}>
        <div className="kpi-value" style={{ color: 'var(--color-warning)', fontSize: 20 }}>
          Outstanding
        </div>
        <div className="kpi-label" style={{ marginTop: 4 }}>
          {currencyEntries.length
            ? currencyEntries.map(([code, amount]) => `${code} ${formatAmount(amount)}`).join(' · ')
            : '—'}
        </div>
      </div>
    </div>
  );
}
