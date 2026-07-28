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
  });

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-header">
        <h2>Needs Attention</h2>
        <span className="dashboard-panel-subtitle">Most overdue PIs (&gt; 30 days, not yet received)</span>
      </div>
      <div className="dashboard-panel-body">
        {overdueQuery.isLoading ? (
          <div className="empty-state">Loading…</div>
        ) : !overdueQuery.data?.length ? (
          <div className="empty-state">Nothing overdue — great work!</div>
        ) : (
          <table className="data-table dashboard-mini-table">
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
                <tr key={entry.id} onClick={() => navigate(`/tracker?entryId=${entry.id}`)} style={{ cursor: 'pointer' }}>
                  <td>{entry.dprNo}</td>
                  <td>{entry.vesselName}</td>
                  <td>{entry.vendorName}</td>
                  <td>
                    {entry.currency} {formatAmount(entry.amountInr)}
                  </td>
                  <td style={{ color: 'var(--color-danger)', fontWeight: 700 }}>{entry.daysSincePayment}</td>
                  <td>
                    <StatusBadge status={entry.followupStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
