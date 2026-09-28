import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Premium SVG Icons
const Icons = {
  Total:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="9" y2="9"/><line x1="3" y1="15" x2="9" y2="15"/></svg>,
  Received:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  NotFollowed: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  Reminder:    () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
  Check:       () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  Discrepancy: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Scheduled:   () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Overdue:     () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="M22 6 19 3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></svg>,
};

const CARDS = [
  { key: 'total',         label: 'Total Invoices',        icon: <Icons.Total />,        tone: 'info',    accent: '#3B82F6' },
  { key: 'received',      label: 'Invoice Received',      icon: <Icons.Received />,     tone: 'success', accent: '#10B981' },
  { key: 'notFollowedUp', label: 'Not Followed Up',       icon: <Icons.NotFollowed />,  tone: 'danger',  accent: '#EF4444' },
  { key: 'reminderSent',  label: 'Reminder Sent',         icon: <Icons.Reminder />,     tone: 'warning', accent: '#F59E0B' },
  { key: 'internalCheck', label: 'Internal Check',        icon: <Icons.Check />,        tone: 'info',    accent: '#6366F1' },
  { key: 'discrepancy',   label: 'Discrepancy Found',     icon: <Icons.Discrepancy />,  tone: 'warning', accent: '#F97316' },
  { key: 'scheduled',     label: 'Scheduled Action',      icon: <Icons.Scheduled />,    tone: 'success', accent: '#14B8A6' },
  { key: 'overdue30Plus', label: 'Overdue > 30 Days',     icon: <Icons.Overdue />,      tone: 'danger',  accent: '#DC2626' },
];

export function KpiGrid() {
  const kpiQuery = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => api.get('/dashboard/kpis'),
    refetchInterval: 5 * 60 * 1000,
  });

  if (!kpiQuery.data) return null;

  return (
    <div className="kpi-row">
      {CARDS.map(({ key, label, icon, tone, accent }) => (
        <div className={`kpi-card-premium tone-${tone}`} key={key}>
          {/* Left accent bar */}
          <div className="kpi-accent-bar" style={{ background: accent }} />

          {/* Icon */}
          <div className="kpi-icon-glass" style={{ color: accent, background: `${accent}18`, borderColor: `${accent}33` }}>
            {icon}
          </div>

          {/* Content */}
          <div className="kpi-content">
            <div className="kpi-value-premium">{kpiQuery.data[key]}</div>
            <div className="kpi-label-premium">{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
