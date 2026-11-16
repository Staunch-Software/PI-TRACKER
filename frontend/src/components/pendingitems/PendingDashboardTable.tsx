import React from 'react';
import type {
  PendingDashboardOwnerGroup,
  PendingDashboardTotals,
} from '../../shared';

interface PendingDashboardTableProps {
  title: string;
  role: 'TSI' | 'TA';
  groups: PendingDashboardOwnerGroup[];
  totals: PendingDashboardTotals;
  searchFilter: string;
  onDrillDown: (
    stage: 'Requisition' | 'Purchase Order' | 'Invoice' | null,
    role: 'TSI' | 'TA',
    ownerName?: string,
    vesselName?: string
  ) => void;
}

function getInitials(name: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function PendingDashboardTable({
  title,
  role,
  groups,
  totals,
  searchFilter,
  onDrillDown,
}: PendingDashboardTableProps) {
  const query = searchFilter.trim().toLowerCase();

  // Filter groups and vessels based on search query
  const filteredGroups = groups
    .map((g) => {
      const ownerMatches = g.ownerName.toLowerCase().includes(query);
      const filteredVessels = g.vessels.filter(
        (v) => ownerMatches || v.vesselName.toLowerCase().includes(query)
      );
      if (filteredVessels.length === 0) return null;
      return {
        ...g,
        vessels: filteredVessels,
      };
    })
    .filter((g): g is PendingDashboardOwnerGroup => g !== null);

  const roleColorClass = role === 'TSI' ? 'role-badge-tsi' : 'role-badge-ta';

  // If searching and this role has 0 matching records, do not show an empty table card
  if (query !== '' && filteredGroups.length === 0) {
    return null;
  }

  const displayedAssignedVessels = filteredGroups.reduce((acc, g) => acc + g.vessels.length, 0);
  const displayedTotals = query !== '' ? {
    requisitionTotal: filteredGroups.reduce((acc, g) => acc + g.requisitionTotal, 0),
    poTotal: filteredGroups.reduce((acc, g) => acc + g.poTotal, 0),
    invoiceTotal: filteredGroups.reduce((acc, g) => acc + g.invoiceTotal, 0),
    grandTotal: filteredGroups.reduce((acc, g) => acc + g.totalCount, 0),
  } : totals;

  return (
    <div className={`pending-dashboard-card card-role-${role.toLowerCase()}`}>
      <div className="pending-dashboard-card-header">
        <div className="pending-dashboard-card-title-group">
          <div className={`pending-dashboard-role-badge ${roleColorClass}`}>
            {role === 'TSI' ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            )}
            <span>{role}</span>
          </div>
          <h2 className="pending-dashboard-card-title">{title}</h2>
        </div>
        <div className="pending-dashboard-card-stats-pills">
          <span className="pending-stat-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/></svg>
            <span className="stat-pill-label">Assigned Vessels:</span>
            <span className="stat-pill-value">{displayedAssignedVessels}</span>
          </span>
          <span className="pending-stat-pill highlight">
            <span className="stat-pill-label">{query ? 'Filtered Pending:' : 'Total Pending:'}</span>
            <span className="stat-pill-value">{displayedTotals.grandTotal}</span>
          </span>
        </div>
      </div>

      <div className="pending-dashboard-table-scroll">
        <table className="data-table pending-dashboard-table">
          <thead>
            <tr>
              <th style={{ width: '220px' }}>
                <div className="th-content-wrap">
                  <span className="th-dot dot-owner" />
                  <span>Owner ({role})</span>
                </div>
              </th>
              <th style={{ width: '220px' }}>
                <div className="th-content-wrap">
                  <span className="th-dot dot-vessel" />
                  <span>Vessel</span>
                </div>
              </th>
              <th style={{ width: '135px', textAlign: 'center' }}>
                <div className="th-content-wrap center">
                  <span className="th-dot dot-pr" />
                  <span>Requisitions</span>
                </div>
              </th>
              <th style={{ width: '145px', textAlign: 'center' }}>
                <div className="th-content-wrap center">
                  <span className="th-dot dot-po" />
                  <span>Purchase Orders</span>
                </div>
              </th>
              <th style={{ width: '135px', textAlign: 'center' }}>
                <div className="th-content-wrap center">
                  <span className="th-dot dot-inv" />
                  <span>Invoices</span>
                </div>
              </th>
              <th style={{ width: '135px', textAlign: 'center' }}>
                <div className="th-content-wrap center">
                  <span className="th-dot dot-total" />
                  <span>Total Pending</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td colSpan={6} className="pending-items-empty">
                  No {role} pending items match the search criteria.
                </td>
              </tr>
            ) : (
              filteredGroups.map((g) => (
                <React.Fragment key={g.ownerName}>
                  {g.vessels.map((v, vIdx) => (
                    <tr key={`${g.ownerName}-${v.vesselName}`} className="dashboard-vessel-row">
                      {vIdx === 0 ? (
                        <td
                          rowSpan={g.vessels.length}
                          className="dashboard-owner-cell"
                        >
                          <div className="dashboard-owner-name-wrap">
                            <div className={`dashboard-owner-avatar ${role === 'TSI' ? 'avatar-tsi' : 'avatar-ta'}`}>
                              {getInitials(g.ownerName)}
                            </div>
                            <div className="dashboard-owner-text">
                              <span className="dashboard-owner-name">{g.ownerName}</span>
                              <span className="dashboard-owner-sub">
                                {g.vessels.length} {g.vessels.length === 1 ? 'Vessel' : 'Vessels'} Assigned
                              </span>
                            </div>
                          </div>
                        </td>
                      ) : null}
                      <td className="vessel-name-cell">
                        <div className="dashboard-vessel-name-wrap">
                          <div className="vessel-icon-circle">
                            <svg className="vessel-ship-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7"/><path d="M10 4V1"/><path d="M14 4V1"/><path d="M12 1v9"/></svg>
                          </div>
                          <span className="vessel-text-bold">{v.vesselName}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {v.requisitionCount > 0 ? (
                          <button
                            type="button"
                            className="dashboard-cell-badge badge-pr"
                            onClick={() =>
                              onDrillDown('Requisition', role, g.ownerName, v.vesselName)
                            }
                            title={`View ${v.requisitionCount} Requisition(s) for ${v.vesselName}`}
                          >
                            {v.requisitionCount}
                          </button>
                        ) : (
                          <span className="dashboard-zero-cell">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {v.poCount > 0 ? (
                          <button
                            type="button"
                            className="dashboard-cell-badge badge-po"
                            onClick={() =>
                              onDrillDown('Purchase Order', role, g.ownerName, v.vesselName)
                            }
                            title={`View ${v.poCount} PO(s) for ${v.vesselName}`}
                          >
                            {v.poCount}
                          </button>
                        ) : (
                          <span className="dashboard-zero-cell">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {v.invoiceCount > 0 ? (
                          <button
                            type="button"
                            className="dashboard-cell-badge badge-inv"
                            onClick={() =>
                              onDrillDown('Invoice', role, g.ownerName, v.vesselName)
                            }
                            title={`View ${v.invoiceCount} Invoice(s) for ${v.vesselName}`}
                          >
                            {v.invoiceCount}
                          </button>
                        ) : (
                          <span className="dashboard-zero-cell">—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {v.totalCount > 0 ? (
                          <button
                            type="button"
                            className="dashboard-cell-badge badge-total"
                            onClick={() =>
                              onDrillDown(null, role, g.ownerName, v.vesselName)
                            }
                            title={`View all ${v.totalCount} items for ${v.vesselName}`}
                          >
                            {v.totalCount}
                          </button>
                        ) : (
                          <span className="dashboard-zero-cell">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* Owner Subtotal Row */}
                  <tr className="dashboard-subtotal-row">
                    <td colSpan={2} className="dashboard-subtotal-label">
                      <div className="subtotal-chip-container">
                        <div className="subtotal-chip-badge">
                          <span className="subtotal-sigma-symbol">∑</span>
                          <span className="subtotal-chip-tag">SUBTOTAL</span>
                        </div>
                        <span className="subtotal-owner-chip-name">{g.ownerName}</span>
                        <span className="subtotal-vessel-count-chip">
                          {g.vessels.length} {g.vessels.length === 1 ? 'Vessel' : 'Vessels'}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {g.requisitionTotal > 0 ? (
                        <button
                          type="button"
                          className="dashboard-subtotal-badge badge-pr-sub"
                          onClick={() => onDrillDown('Requisition', role, g.ownerName)}
                          title={`View all ${g.requisitionTotal} Requisitions for ${g.ownerName}`}
                        >
                          {g.requisitionTotal}
                        </button>
                      ) : (
                        <span className="dashboard-zero-cell">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {g.poTotal > 0 ? (
                        <button
                          type="button"
                          className="dashboard-subtotal-badge badge-po-sub"
                          onClick={() => onDrillDown('Purchase Order', role, g.ownerName)}
                          title={`View all ${g.poTotal} POs for ${g.ownerName}`}
                        >
                          {g.poTotal}
                        </button>
                      ) : (
                        <span className="dashboard-zero-cell">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {g.invoiceTotal > 0 ? (
                        <button
                          type="button"
                          className="dashboard-subtotal-badge badge-inv-sub"
                          onClick={() => onDrillDown('Invoice', role, g.ownerName)}
                          title={`View all ${g.invoiceTotal} Invoices for ${g.ownerName}`}
                        >
                          {g.invoiceTotal}
                        </button>
                      ) : (
                        <span className="dashboard-zero-cell">—</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {g.totalCount > 0 ? (
                        <button
                          type="button"
                          className="dashboard-subtotal-badge badge-total"
                          onClick={() => onDrillDown(null, role, g.ownerName)}
                          title={`View all ${g.totalCount} items for ${g.ownerName}`}
                        >
                          {g.totalCount}
                        </button>
                      ) : (
                        <span className="dashboard-zero-cell">0</span>
                      )}
                    </td>
                  </tr>
                </React.Fragment>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="dashboard-grand-total-row">
              <td colSpan={2} className="dashboard-grand-total-label">
                <div className="grand-total-wrap">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                  <span className="grand-total-title">{role} {query ? 'Filtered' : 'Total'} Pending</span>
                </div>
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="dashboard-grand-badge badge-pr-grand"
                  onClick={() => onDrillDown('Requisition', role)}
                  title={`View all ${displayedTotals.requisitionTotal} ${role} Requisitions`}
                >
                  {displayedTotals.requisitionTotal}
                </button>
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="dashboard-grand-badge badge-po-grand"
                  onClick={() => onDrillDown('Purchase Order', role)}
                  title={`View all ${displayedTotals.poTotal} ${role} POs`}
                >
                  {displayedTotals.poTotal}
                </button>
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="dashboard-grand-badge badge-inv-grand"
                  onClick={() => onDrillDown('Invoice', role)}
                  title={`View all ${displayedTotals.invoiceTotal} ${role} Invoices`}
                >
                  {displayedTotals.invoiceTotal}
                </button>
              </td>
              <td style={{ textAlign: 'center' }}>
                <button
                  type="button"
                  className="dashboard-grand-badge badge-total"
                  onClick={() => onDrillDown(null, role)}
                  title={`View all ${displayedTotals.grandTotal} ${role} Pending Items`}
                >
                  {displayedTotals.grandTotal}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
