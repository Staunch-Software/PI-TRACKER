import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import type { OverdueEntry } from '../../shared';
import { formatAmount } from '../../lib/format';
import { StatusBadge } from '../table/StatusBadge';

export function NeedsAttentionTable() {
  const navigate = useNavigate();
  const overdueQuery = useQuery({
    queryKey: ['dashboard-overdue'],
    queryFn: () => api.get<OverdueEntry[]>('/dashboard/overdue?limit=10'),
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <div>
          <h2 className="dash-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6, verticalAlign: 'text-bottom' }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Needs Attention
          </h2>
          <p className="dash-panel-subtitle">Most overdue PIs (&gt; 30 days, not yet received)</p>
        </div>
      </div>
      <div className="dash-panel-body">
        {overdueQuery.isLoading ? (
          <div className="dash-empty">Loading…</div>
        ) : !overdueQuery.data?.length ? (
          <div className="dash-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <br />
            Nothing overdue — great work!
          </div>
        ) : (
          <table className="dash-mini-table">
            <thead>
              <tr>
                <th>DPR No.</th>
                <th>Vessel</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Days Overdue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {overdueQuery.data.map((entry) => (
                <tr key={entry.id} onClick={() => navigate(`/tracker?entryId=${entry.id}`)}>
                  <td style={{ fontWeight: 700, color: '#111424' }}>{entry.dprNo ?? '—'}</td>
                  <td>{entry.vesselName}</td>
                  <td style={{ color: '#6B7280' }}>{entry.vendorName}</td>
                  <td style={{ fontWeight: 600 }}>{entry.currency} {formatAmount(entry.amountInr)}</td>
                  <td><span className="dash-overdue-days">{entry.daysSincePayment}d</span></td>
                  <td><StatusBadge status={entry.followupStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
