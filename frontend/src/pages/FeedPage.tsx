import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { AuditAction, type AuditLogEntry, type PaginatedResult, type Vessel } from '../shared';
import { formatDateTime } from '../lib/format';
import { MultiSelectDropdown } from '../components/common/MultiSelectDropdown';
import './Feed.css';

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  IMPORT: 'Imported',
  ATTACH: 'Attached',
  MARK_RECEIVED: 'Received',
};

const ACTION_OPTIONS = Object.values(AuditAction).map((a) => ({ value: a, label: ACTION_LABELS[a] ?? a }));

type ReadTab = 'all' | 'unread' | 'read';

function ActionSvg({ action }: { action: string }) {
  switch (action) {
    case 'CREATE':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>;
    case 'UPDATE':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case 'DELETE':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
    case 'IMPORT':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
    case 'ATTACH':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
    case 'MARK_RECEIVED':
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>;
    default:
      return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="4"/></svg>;
  }
}

export function FeedPage() {
  const [readTab, setReadTab] = useState<ReadTab>('all');
  const [search, setSearch] = useState('');
  const [vesselIds, setVesselIds] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const vesselsQuery = useQuery({ queryKey: ['vessels'], queryFn: () => api.get<Vessel[]>('/vessels') });
  const vesselOptions = (vesselsQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }));

  const params = new URLSearchParams();
  if (readTab !== 'all') params.set('read_state', readTab);
  if (search) params.set('search', search);
  vesselIds.forEach((id) => params.append('vessel_id', id));
  actions.forEach((a) => params.append('action', a));
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  params.set('page', '1');
  params.set('page_size', String(PAGE_SIZE));

  const feedQuery = useQuery({
    queryKey: ['audit-log', readTab, search, vesselIds, actions, dateFrom, dateTo],
    queryFn: () => api.get<PaginatedResult<AuditLogEntry>>(`/audit-log?${params.toString()}`),
  });

  const unreadCountQuery = useQuery({
    queryKey: ['audit-log-unread-count'],
    queryFn: () => api.get<PaginatedResult<AuditLogEntry>>('/audit-log?read_state=unread&page=1&page_size=1'),
  });
  const unreadCount = unreadCountQuery.data?.total ?? 0;

  const markReadMutation = useMutation({
    mutationFn: (id: number) => api.post(`/audit-log/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-log'] });
      queryClient.invalidateQueries({ queryKey: ['audit-log-unread-count'] });
    },
  });

  function handleView(item: AuditLogEntry) {
    if (!markReadMutation.isPending && !item.isRead) markReadMutation.mutate(item.id);
    if (item.entityType === 'pi_entry') navigate(`/tracker?entryId=${item.entityId}`);
  }

  function resetFilters<T>(setter: (v: T) => void) {
    return (v: T) => setter(v);
  }

  const total = feedQuery.data?.total ?? 0;

  return (
    <div className="fp-root">

      {/* ── HEADER ── */}
      <div className="fp-header">
        <div className="fp-header-left">
          <div className="fp-header-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div>
            <h1 className="fp-title">Activity Feed</h1>
            <p className="fp-subtitle">Real-time log of every change across the tracker.</p>
          </div>
        </div>

        <div className="fp-header-right">
          <div className="fp-count-badge">
            <span className="fp-count-pulse" />
            {total} Events Logged
          </div>
        </div>
      </div>

      {/* ── PREMIUM CONTROLS (TABS + FILTERS) ── */}
      <div className="fp-controls">
        <div className="fp-tabs-container">
          <div className="fp-tabs-premium">
            {(['all', 'unread', 'read'] as ReadTab[]).map((tab) => (
              <button
                key={tab}
                className={`fp-tab-premium${readTab === tab ? ' active' : ''}`}
                onClick={() => resetFilters(setReadTab)(tab)}
              >
                {tab === 'all' ? 'All' : tab === 'unread' ? 'Unread' : 'Read'}
                {tab === 'unread' && unreadCount > 0 && (
                  <span className="fp-tab-dot" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="fp-filters">
          <div className="fp-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="search"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => resetFilters(setSearch)(e.target.value)}
            />
          </div>
          <MultiSelectDropdown options={vesselOptions} selected={vesselIds} onChange={resetFilters(setVesselIds)} allLabel="All vessels" />
          <MultiSelectDropdown options={ACTION_OPTIONS} selected={actions} onChange={resetFilters(setActions)} allLabel="All actions" />
          <div className="fp-date-pair">
            <div className="fp-date-field">
              <label>From</label>
              <input type="date" value={dateFrom} onChange={(e) => resetFilters(setDateFrom)(e.target.value)} />
            </div>
            <div className="fp-date-field">
              <label>To</label>
              <input type="date" value={dateTo} onChange={(e) => resetFilters(setDateTo)(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {/* ── TIMELINE FEED ── */}
      <div className="fp-feed-wrap">
        {feedQuery.isLoading ? (
          <div className="fp-empty">
            <div className="fp-empty-spinner" />
            <p>Loading timeline…</p>
          </div>
        ) : !feedQuery.data?.items.length ? (
          <div className="fp-empty">
            <div className="fp-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
            </div>
            <p>No activity matches these filters.</p>
          </div>
        ) : (
          <div className="fp-timeline">
            {feedQuery.data.items.map((item) => (
              <div className={`fp-timeline-item${item.isRead ? '' : ' fp-timeline-item--unread'}`} key={item.id}>
                
                {/* Timeline Axis & Icon */}
                <div className="fp-timeline-axis">
                  <div className="fp-timeline-line" />
                  <div className="fp-timeline-icon">
                    <ActionSvg action={item.action} />
                  </div>
                </div>

                {/* Content Card */}
                <div className="fp-timeline-content">
                  <div className="fp-timeline-header">
                    <div className="fp-timeline-type">
                      {ACTION_LABELS[item.action] ?? item.action}
                      {!item.isRead && <span className="fp-badge-new">New</span>}
                    </div>
                    <div className="fp-timeline-time">
                      {formatDateTime(item.createdAt)}
                    </div>
                  </div>

                  <p className="fp-timeline-summary">
                    {item.summary ?? `${item.changedByName ?? 'Someone'} ${item.action.toLowerCase()}d ${item.entityType}`}
                  </p>

                  <div className="fp-timeline-footer">
                    <div className="fp-timeline-meta">
                      {item.vesselName && (
                        <span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 17h18M3 17 5.5 8h13L21 17M12 3v5"/></svg>
                          {item.vesselName}
                        </span>
                      )}
                      {item.changedByName && (
                        <span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                          {item.changedByName}
                        </span>
                      )}
                    </div>

                    {/* Actions with CSS Tooltips */}
                    <div className="fp-timeline-actions">
                      {!item.isRead && (
                        <button
                          className="fp-btn-highlight fp-btn-read"
                          onClick={() => markReadMutation.mutate(item.id)}
                          disabled={markReadMutation.isPending}
                          data-tooltip="Mark as read"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        </button>
                      )}
                      {item.entityType === 'pi_entry' && (
                        <button
                          className="fp-btn-highlight fp-btn-view"
                          onClick={() => handleView(item)}
                          data-tooltip="View entry"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
