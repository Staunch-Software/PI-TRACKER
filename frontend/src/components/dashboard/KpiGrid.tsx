import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { DashboardKpis } from '../../shared';

const CARDS: { key: keyof DashboardKpis; label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }[] = [
  { key: 'total', label: 'Total Rows', tone: 'info' },
  { key: 'received', label: 'Final Invoice Received', tone: 'success' },
  { key: 'notFollowedUp', label: 'Pending - Not Yet Followed Up', tone: 'danger' },
  { key: 'reminderSent', label: 'Pending - Reminder Sent', tone: 'warning' },
  { key: 'internalCheck', label: 'Pending - Internal Check', tone: 'warning' },
  { key: 'discrepancy', label: 'Pending - Discrepancy to Resolve', tone: 'danger' },
  { key: 'scheduled', label: 'Pending - Scheduled', tone: 'info' },
  { key: 'other', label: 'Pending - Other', tone: 'warning' },
  { key: 'notApplicable', label: 'Not Applicable', tone: 'neutral' },
  { key: 'overdue30Plus', label: 'Overdue > 30 Days', tone: 'danger' },
];

const TONE_VARS: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  danger: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
  info: { bg: 'var(--color-info-bg)', color: 'var(--color-info)' },
  neutral: { bg: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' },
};

export function KpiGrid() {
  const kpiQuery = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => api.get<DashboardKpis>('/dashboard/kpis'),
    // Counts like "Overdue > 30 Days" are computed live off CURRENT_DATE on the backend, so
    // they tick over at midnight even with nothing else changing — refetch periodically so a
    // tab left open (no refocus/remount to trigger React Query's default refetch) still picks
    // that up instead of showing yesterday's snapshot indefinitely.
    refetchInterval: 5 * 60 * 1000,
  });

  if (!kpiQuery.data) return null;

  return (
    <div className="kpi-grid">
      {CARDS.map(({ key, label, tone }) => {
        const { bg, color } = TONE_VARS[tone];
        return (
          <div className="kpi-card" key={key} style={{ background: bg }}>
            <div className="kpi-value" style={{ color }}>
              {kpiQuery.data![key]}
            </div>
            <div className="kpi-label">{label}</div>
          </div>
        );
      })}
    </div>
  );
}
