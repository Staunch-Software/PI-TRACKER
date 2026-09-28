import { KpiGrid } from '../components/dashboard/KpiGrid.jsx';
import { NeedsAttentionTable } from '../components/dashboard/NeedsAttentionTable';
import { RecentActivityPanel } from '../components/dashboard/RecentActivityPanel';
import '../pages/Dashboard.css';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatTodayDate() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();
  
  return (
    <div className="dash-page">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-header-left">
          <p className="dash-greeting">{getGreeting()}, {user?.fullName || 'User'}</p>
          <h1 className="dash-title">PI Dashboard</h1>
          <p className="dash-subtitle">Real-time status of all Purchase Invoices across Ozellar Marine</p>
        </div>
        <div className="dash-date-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          {formatTodayDate()}
        </div>
      </div>

      {/* KPI Cards — single row of 5+5 (scrolls on mobile, fits on desktop) */}
      <KpiGrid />

      {/* Bottom panels */}
      <div className="dash-panels">
        <NeedsAttentionTable />
        <RecentActivityPanel />
      </div>
    </div>
  );
}
