import { KpiGrid } from '../components/dashboard/KpiGrid';
import { NeedsAttentionTable } from '../components/dashboard/NeedsAttentionTable';
import { RecentActivityPanel } from '../components/dashboard/RecentActivityPanel';

export function DashboardPage() {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Follow-up status summary across the fleet.</p>
        </div>
      </div>
      <KpiGrid />
      <div className="dashboard-grid">
        <NeedsAttentionTable />
        <RecentActivityPanel />
      </div>
    </div>
  );
}
