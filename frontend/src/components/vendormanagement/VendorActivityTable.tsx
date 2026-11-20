import { Fragment, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { PaginatedResult, VendorActivityEntry } from '../../shared';
import { SearchIcon } from '../common/SearchIcon';

const PAGE_SIZE = 50;

type StatusFilter = 'all' | 'active' | 'inactive';
type SortBy = 'total_pos' | 'vendor_name' | 'latest_po_date';

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* "Active / Inactive Vendors" tab — a vendor is Active iff po_entries has at least one PO whose
   own (free-text) vendor name matches this vendor's vendor_name, computed live by the backend
   (see api/routes/vendor_management.py's get_vendor_activity). Self-contained (own search/filter/
   sort/pagination state) rather than threaded through VendorManagementPage's shared state, since
   its query shape (status filter, sort, computed-not-stored columns) doesn't fit the other three
   tabs' simpler "search + page" model. */
export function VendorActivityTable() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('total_pos');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ['vendor-activity', search, status, sortBy, sortDir, page],
    queryFn: () => {
      const params = new URLSearchParams({
        search,
        sort_by: sortBy,
        sort_dir: sortDir,
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      if (status !== 'all') params.set('status', status);
      return api.get<PaginatedResult<VendorActivityEntry>>(`/vendor-management/activity?${params.toString()}`);
    },
    placeholderData: keepPreviousData,
  });

  const items = query.data?.items ?? [];
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;

  function toggleExpanded(vendorCode: string) {
    setExpanded((prev) => ({ ...prev, [vendorCode]: !prev[vendorCode] }));
  }

  function toggleSort(field: SortBy) {
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'vendor_name' ? 'asc' : 'desc');
    }
    setPage(1);
  }

  return (
    <>
      <div className="tracker-toolbar">
        <div className="tracker-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search vendors by code or name…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
          />
        </div>
        <div className="vendor-activity-status-filter">
          {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`vendor-activity-status-btn ${status === s ? 'active' : ''}`}
              onClick={() => {
                setStatus(s);
                setPage(1);
              }}
            >
              {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>
        <div className="tracker-toolbar-spacer" />
      </div>

      {query.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading vendors…</div>
          </div>
        </div>
      ) : query.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load vendor activity.</div>
        </div>
      ) : (
        <>
          <div className="tracker-table-shell vendor-management-table-shell">
            <table className="data-table vendor-management-table vendor-activity-table">
              <thead>
                <tr>
                  <th className="col-sno">S.No</th>
                  <th className="col-vendor">Vendor</th>
                  <th title="Vendor Type, Country, Currency, Email — from SmartPAL's vendor master.">Details</th>
                  <th className="col-center">Status</th>
                  <th className="col-center sortable" onClick={() => toggleSort('total_pos')} title="Sort by Total POs">
                    Total POs {sortBy === 'total_pos' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th className="sortable" onClick={() => toggleSort('latest_po_date')} title="Sort by Latest PO date">
                    Latest PO {sortBy === 'latest_po_date' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th title="Click a row to expand its per-vessel PO count breakdown.">Vessel-wise Breakup</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="empty-state">No vendors match the current search/filter.</td>
                  </tr>
                )}
                {items.map((entry, idx) => {
                  const rowNumber = (page - 1) * PAGE_SIZE + idx + 1;
                  const isExpanded = !!expanded[entry.vendorCode];
                  const topVessels = entry.vesselBreakdown.slice(0, 2);
                  const remaining = entry.vesselBreakdown.length - topVessels.length;

                  return (
                    <Fragment key={entry.vendorCode}>
                      <tr>
                        <td className="col-sno">
                          <span className="vendor-sno-pill">{rowNumber}</span>
                        </td>
                        <td className="col-vendor">
                          <div className="vendor-name-text">{entry.vendorName ?? entry.vendorCode}</div>
                          <div className="vendor-code-badge">{entry.vendorCode}</div>
                        </td>
                        <td>
                          <div className="vendor-activity-details">
                            <div>{entry.vendorType ?? '—'}</div>
                            <div>{[entry.city, entry.country].filter(Boolean).join(', ') || '—'}</div>
                            <div>{entry.currency ?? '—'}</div>
                            <div className="vendor-activity-details-email">{entry.email ?? '—'}</div>
                          </div>
                        </td>
                        <td className="col-center">
                          <span className={`vendor-badge ${entry.isActive ? 'vendor-badge-ok' : 'vendor-badge-inactive'}`}>
                            <span className="vendor-badge-dot" />
                            {entry.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="col-center">
                          <span className="vendor-activity-total-pos">{entry.totalPos}</span>
                        </td>
                        <td>
                          {entry.latestPoNo ? (
                            <>
                              <div className="vendor-name-text" style={{ fontSize: 12.5 }}>{entry.latestPoNo}</div>
                              <div className="vendor-activity-details-email">{formatDate(entry.latestPoDate)}</div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {entry.vesselBreakdown.length === 0 ? (
                            '—'
                          ) : (
                            <button type="button" className="vendor-activity-expand-btn" onClick={() => toggleExpanded(entry.vendorCode)}>
                              <ChevronIcon expanded={isExpanded} />
                              {topVessels.map((v) => v.vesselName).join(', ')}
                              {remaining > 0 ? ` +${remaining} more` : ''}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && entry.vesselBreakdown.length > 0 && (
                        <tr className="vendor-activity-expanded-row">
                          <td />
                          <td colSpan={6}>
                            <table className="vendor-activity-vessel-table">
                              <thead>
                                <tr>
                                  <th>Vessel</th>
                                  <th>POs Placed</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.vesselBreakdown.map((v) => (
                                  <tr key={v.vesselName}>
                                    <td>{v.vesselName}</td>
                                    <td>{v.poCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tracker-pagination">
            <div className="pagination-center">
              <button className="pagination-nav-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} title="Previous Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <div className="pagination-current">
                Page <strong>{page}</strong> of {totalPages}
              </div>
              <button className="pagination-nav-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} title="Next Page">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div className="pagination-right">
              <span className="pagination-total">
                {query.data ? (
                  <><strong>{query.data.total.toLocaleString()}</strong> vendors</>
                ) : (
                  '...'
                )}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
