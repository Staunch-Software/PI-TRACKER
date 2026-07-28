import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { AuditLogEntry, PaginatedResult } from '../../shared';
import { formatDateTime } from '../../lib/format';

const ACTION_ICONS: Record<string, string> = {
  CREATE: '+',
  UPDATE: '✎',
  DELETE: '×',
  IMPORT: '⇪',
  ATTACH: '📎',
  MARK_RECEIVED: '✓',
};

export function RecentActivityPanel() {
  const feedQuery = useQuery({
    queryKey: ['audit-log', 'dashboard-recent'],
    queryFn: () => api.get<PaginatedResult<AuditLogEntry>>('/audit-log?page=1&page_size=5'),
  });

  return (
    <div className="card dashboard-panel">
      <div className="dashboard-panel-header">
        <h2>Recent Activity</h2>
        <Link to="/feed" className="dashboard-panel-link">
          View all →
        </Link>
      </div>
      <div className="dashboard-panel-body">
        {feedQuery.isLoading ? (
          <div className="empty-state">Loading…</div>
        ) : !feedQuery.data?.items.length ? (
          <div className="empty-state">No activity yet.</div>
        ) : (
          <div className="feed-list">
            {feedQuery.data.items.map((item) => (
              <div className="feed-item" key={item.id} style={{ marginBottom: 8 }}>
                <div className="feed-icon">{ACTION_ICONS[item.action] ?? '•'}</div>
                <div className="feed-body">
                  <div className="feed-summary">
                    {item.summary ?? `${item.changedByName ?? 'Someone'} ${item.action.toLowerCase()}d ${item.entityType}`}
                  </div>
                  <div className="feed-time">{formatDateTime(item.createdAt)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
