import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { AuditAction, type AuditLogEntry, type PaginatedResult, type Vessel } from '../shared';
import { formatDateTime } from '../lib/format';
import { MultiSelectDropdown } from '../components/common/MultiSelectDropdown';
import { SearchIcon } from '../components/common/SearchIcon';

const PAGE_SIZE = 30;

const ACTION_ICONS: Record<string, string> = {
  CREATE: '+',
  UPDATE: '✎',
  DELETE: '×',
  IMPORT: '⇪',
  ATTACH: '📎',
  MARK_RECEIVED: '✓',
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  IMPORT: 'Imported',
  ATTACH: 'Attached',
  MARK_RECEIVED: 'Marked Received',
};

const ACTION_OPTIONS = Object.values(AuditAction).map((a) => ({ value: a, label: ACTION_LABELS[a] }));

type ReadTab = 'all' | 'unread' | 'read';

export function FeedPage() {
  const [readTab, setReadTab] = useState<ReadTab>('all');
  const [search, setSearch] = useState('');
  const [vesselIds, setVesselIds] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

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
  params.set('page', String(page));
  params.set('page_size', String(PAGE_SIZE));

  const feedQuery = useQuery({
    queryKey: ['audit-log', readTab, search, vesselIds, actions, dateFrom, dateTo, page],
    queryFn: () => api.get<PaginatedResult<AuditLogEntry>>(`/audit-log?${params.toString()}`),
  });

  // Independent of the tab/search/vessel/action/date filters above — this is the total unread
  // count across the whole feed, for the badge next to the "Unread" tab, not just whatever the
  // current filters happen to match. page_size=1 since only `total` is needed, not the rows.
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
    if (item.entityType === 'pi_entry') {
      navigate(`/tracker?entryId=${item.entityId}`);
    }
  }

  const totalPages = feedQuery.data ? Math.max(1, Math.ceil(feedQuery.data.total / PAGE_SIZE)) : 1;

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setPage(1);
      setter(v);
    };
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Activity Feed</h1>
          <p>Every change made to the tracker — additions, edits, attachments and imports.</p>
        </div>
        <div className="btn-group">
          {(['all', 'unread', 'read'] as ReadTab[]).map((tab) => (
            <button
              key={tab}
              className={`btn ${readTab === tab ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => resetPage(setReadTab)(tab)}
            >
              {tab === 'all' ? 'All' : tab === 'unread' ? 'Unread' : 'Read'}
              {tab === 'unread' && unreadCount > 0 && <span className="unread-count-badge">{unreadCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar-row toolbar-row-fill">
        <div className="search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search feed…"
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
          />
        </div>
        <MultiSelectDropdown
          options={vesselOptions}
          selected={vesselIds}
          onChange={resetPage(setVesselIds)}
          allLabel="All vessels"
        />
        <MultiSelectDropdown
          options={ACTION_OPTIONS}
          selected={actions}
          onChange={resetPage(setActions)}
          allLabel="All actions"
        />
        <div className="date-range-field">
          <label>From</label>
          <input type="date" value={dateFrom} onChange={(e) => resetPage(setDateFrom)(e.target.value)} />
        </div>
        <div className="date-range-field">
          <label>To</label>
          <input type="date" value={dateTo} onChange={(e) => resetPage(setDateTo)(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {feedQuery.isLoading ? (
          <div className="empty-state">Loading activity…</div>
        ) : !feedQuery.data?.items.length ? (
          <div className="empty-state">No activity matches these filters.</div>
        ) : (
          <div className="feed-list feed-list-scroll">
            {feedQuery.data.items.map((item) => (
              <div className={`feed-item${item.isRead ? '' : ' unread'}`} key={item.id}>
                <div className="feed-icon">{ACTION_ICONS[item.action] ?? '•'}</div>
                <div className="feed-body">
                  <div className="feed-summary">
                    {item.summary ?? `${item.changedByName ?? 'Someone'} ${item.action.toLowerCase()}d ${item.entityType}`}
                  </div>
                  <div className="feed-time">
                    {formatDateTime(item.createdAt)}
                    {item.vesselName ? ` · ${item.vesselName}` : ''}
                  </div>
                </div>
                <div className="feed-actions">
                  {!item.isRead && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => markReadMutation.mutate(item.id)}
                      disabled={markReadMutation.isPending}
                    >
                      Mark as Read
                    </button>
                  )}
                  {item.entityType === 'pi_entry' && (
                    <button className="btn btn-secondary" onClick={() => handleView(item)}>
                      View
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {feedQuery.data && feedQuery.data.total > PAGE_SIZE && (
        <div className="pagination">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="pager-btns">
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
