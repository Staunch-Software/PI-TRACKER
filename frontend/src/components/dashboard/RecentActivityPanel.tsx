import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import type { AuditLogEntry, PaginatedResult } from '../../shared';
import { formatDateTime } from '../../lib/format';

const ACTION_META: Record<string, { icon: React.ReactNode; cls: string }> = {
  CREATE:       { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>, cls: 'create' },
  UPDATE:       { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>, cls: 'update' },
  DELETE:       { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>, cls: 'delete' },
  IMPORT:       { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, cls: 'import' },
  ATTACH:       { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>, cls: 'attach' },
  MARK_RECEIVED:{ icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>, cls: 'receive' },
};

export function RecentActivityPanel() {
  const feedQuery = useQuery({
    queryKey: ['audit-log', 'dashboard-recent'],
    queryFn: () => api.get<PaginatedResult<AuditLogEntry>>('/audit-log?page=1&page_size=6'),
  });

  return (
    <div className="dash-panel">
      <div className="dash-panel-header">
        <div>
          <h2 className="dash-panel-title">Recent Activity</h2>
          <p className="dash-panel-subtitle">Latest changes across the fleet</p>
        </div>
        <Link to="/feed" className="dash-panel-link">View all →</Link>
      </div>
      <div className="dash-panel-body">
        {feedQuery.isLoading ? (
          <div className="dash-empty">Loading…</div>
        ) : !feedQuery.data?.items.length ? (
          <div className="dash-empty">No activity yet.</div>
        ) : (
          <div className="dash-feed-list">
            {feedQuery.data.items.map((item) => {
              const meta = ACTION_META[item.action] ?? { icon: '•', cls: 'default' };
              return (
                <div className="dash-feed-item" key={item.id}>
                  <div className={`dash-feed-icon ${meta.cls}`}>{meta.icon}</div>
                  <div className="dash-feed-content">
                    <div className="dash-feed-summary">
                      {item.summary ?? `${item.changedByName ?? 'Someone'} ${item.action.toLowerCase()}d ${item.entityType}`}
                    </div>
                    <div className="dash-feed-time">{formatDateTime(item.createdAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
