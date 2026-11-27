import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { PendingDashboardSummaryResponse } from '../../shared';
import { roleLabel } from '../../shared';
import { SearchIcon } from '../common/SearchIcon';
import { PendingDashboardTable } from './PendingDashboardTable';
import { PendingItemsMailModal } from '../modals/PendingItemsMailModal';

interface PendingDashboardPageProps {
  onDrillDown: (
    stage: 'Requisition' | 'Purchase Order' | 'Invoice' | null,
    role: 'TSI' | 'TA',
    ownerName?: string,
    vesselName?: string
  ) => void;
}

type RoleFilter = 'ALL' | 'TSI' | 'TA';

export function PendingDashboardPage({ onDrillDown }: PendingDashboardPageProps) {
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isMailModalOpen, setIsMailModalOpen] = useState(false);
  const [mailSuccessMessage, setMailSuccessMessage] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['pending-items-dashboard-summary'],
    queryFn: () => api.get<PendingDashboardSummaryResponse>('/pending-items/dashboard-summary'),
    placeholderData: keepPreviousData,
  });

  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const { blob, filename } = await api.getBlob(
        `/pending-items/dashboard-summary/export?role=${roleFilter}`
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? `${roleFilter}_Pending_Dashboard_Summary.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to export dashboard summary.');
    } finally {
      setIsExporting(false);
    }
  }

  const data = summaryQuery.data;

  return (
    <div className="pending-dashboard-view">
      {/* Executive Compact KPI Overview Cards */}
      {data && (
        <div className="pending-kpi-grid">
          {/* Card 1: Fleet Total */}
          <div className="pending-kpi-card compact kpi-card-fleet">
            <div className="kpi-compact-icon icon-fleet">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div className="kpi-compact-content">
              <div className="kpi-compact-header">
                <span className="kpi-compact-title">Fleet Total Pending</span>
              </div>
              <div className="kpi-compact-data">
                <span className="kpi-compact-num text-fleet">{data.fleetTotals.grandTotal}</span>
                <div className="kpi-compact-splits">
                  <span className="compact-split-pill tsi" title={`${roleLabel('TSI')} Fleet Pending`}>{roleLabel('TSI')} <strong>{data.tsiTotals.grandTotal}</strong></span>
                  <span className="compact-split-pill ta" title={`${roleLabel('TA')} Fleet Pending`}>{roleLabel('TA')} <strong>{data.taTotals.grandTotal}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Requisitions */}
          <div
            className="pending-kpi-card compact kpi-card-requisition clickable"
            onClick={() => onDrillDown('Requisition', 'TSI')}
            title="Click to view Requisition items"
          >
            <div className="kpi-compact-icon icon-pr">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
            <div className="kpi-compact-content">
              <div className="kpi-compact-header">
                <span className="kpi-compact-title">Requisitions</span>
              </div>
              <div className="kpi-compact-data">
                <span className="kpi-compact-num text-pr">{data.fleetTotals.requisitionTotal}</span>
                <div className="kpi-compact-splits">
                  <span className="compact-split-pill tsi" title={`${roleLabel('TSI')} Requisitions Pending`}>{roleLabel('TSI')} <strong>{data.tsiTotals.requisitionTotal}</strong></span>
                  <span className="compact-split-pill ta" title={`${roleLabel('TA')} Requisitions Pending`}>{roleLabel('TA')} <strong>{data.taTotals.requisitionTotal}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Purchase Orders */}
          <div
            className="pending-kpi-card compact kpi-card-po clickable"
            onClick={() => onDrillDown('Purchase Order', 'TA')}
            title="Click to view Purchase Order items"
          >
            <div className="kpi-compact-icon icon-po">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </div>
            <div className="kpi-compact-content">
              <div className="kpi-compact-header">
                <span className="kpi-compact-title">Purchase Orders</span>
              </div>
              <div className="kpi-compact-data">
                <span className="kpi-compact-num text-po">{data.fleetTotals.poTotal}</span>
                <div className="kpi-compact-splits">
                  <span className="compact-split-pill tsi" title={`${roleLabel('TSI')} POs Pending`}>{roleLabel('TSI')} <strong>{data.tsiTotals.poTotal}</strong></span>
                  <span className="compact-split-pill ta" title={`${roleLabel('TA')} POs Pending`}>{roleLabel('TA')} <strong>{data.taTotals.poTotal}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: Invoices */}
          <div
            className="pending-kpi-card compact kpi-card-invoice clickable"
            onClick={() => onDrillDown('Invoice', 'TA')}
            title="Click to view Invoice items"
          >
            <div className="kpi-compact-icon icon-inv">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
            </div>
            <div className="kpi-compact-content">
              <div className="kpi-compact-header">
                <span className="kpi-compact-title">Invoices</span>
              </div>
              <div className="kpi-compact-data">
                <span className="kpi-compact-num text-inv">{data.fleetTotals.invoiceTotal}</span>
                <div className="kpi-compact-splits">
                  <span className="compact-split-pill tsi" title={`${roleLabel('TSI')} Invoices Pending`}>{roleLabel('TSI')} <strong>{data.tsiTotals.invoiceTotal}</strong></span>
                  <span className="compact-split-pill ta" title={`${roleLabel('TA')} Invoices Pending`}>{roleLabel('TA')} <strong>{data.taTotals.invoiceTotal}</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Notification Banner */}
      {mailSuccessMessage && (
        <div className="pending-mail-success-toast">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{mailSuccessMessage}</span>
          </div>
          <button
            type="button"
            className="pending-mail-toast-close"
            onClick={() => setMailSuccessMessage(null)}
            aria-label="Close notification"
          >
            ×
          </button>
        </div>
      )}

      {/* Control / Filter Bar */}
      <div className="tracker-toolbar pending-dashboard-toolbar">
        <div className="tracker-search-wrap dashboard-search-wrap">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search by owner name or vessel name…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="dashboard-search-clear-btn"
              onClick={() => setSearchTerm('')}
              title="Clear search"
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>

        <div className="pending-role-pills">
          <button
            type="button"
            className={`pending-role-pill ${roleFilter === 'ALL' ? 'pending-role-pill-all active' : ''}`}
            onClick={() => setRoleFilter('ALL')}
          >
            All Pending
            {data && <span className="pending-role-pill-count">{data.fleetTotals.grandTotal}</span>}
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-tsi ${roleFilter === 'TSI' ? 'active' : ''}`}
            onClick={() => setRoleFilter('TSI')}
          >
            {roleLabel('TSI')} Pending
            {data && <span className="pending-role-pill-count">{data.tsiTotals.grandTotal}</span>}
          </button>
          <button
            type="button"
            className={`pending-role-pill pending-role-pill-ta ${roleFilter === 'TA' ? 'active' : ''}`}
            onClick={() => setRoleFilter('TA')}
          >
            {roleLabel('TA')} Pending
            {data && <span className="pending-role-pill-count">{data.taTotals.grandTotal}</span>}
          </button>
        </div>

        <div className="tracker-toolbar-spacer" />

        <div className="pending-dashboard-actions">
          <button
            type="button"
            className="btn-tracker-action btn-pending-mail-trigger"
            onClick={() => setIsMailModalOpen(true)}
            title={`Preview and send dashboard summary email to ${roleFilter === 'ALL' ? `Fleet (${roleLabel('TSI')} & ${roleLabel('TA')})` : roleLabel(roleFilter)}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <span>
              {roleFilter === 'ALL'
                ? `Email All (${roleLabel('TSI')} & ${roleLabel('TA')})`
                : roleFilter === 'TSI'
                  ? `Email ${roleLabel('TSI')} Summary`
                  : `Email ${roleLabel('TA')} Summary`}
            </span>
          </button>

          <button
            className="btn-tracker-action btn-tracker-secondary"
            onClick={() => summaryQuery.refetch()}
            title="Refresh dashboard counts"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Refresh
          </button>

          <button
            className="btn-tracker-action btn-tracker-primary"
            onClick={handleExport}
            disabled={isExporting}
            title={`Export ${roleLabel('TSI')} & ${roleLabel('TA')} Summary tables to Excel`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {isExporting ? 'Exporting…' : 'Export Summary'}
          </button>
        </div>
      </div>

      {/* Drill-down guide banner */}
      <div className="pending-drilldown-guide">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>
          <strong>Pro-Tip:</strong> Click on any badge number in the tables below to immediately open the <strong>Detailed Items</strong> view pre-filtered to those exact pending items.
        </span>
      </div>

      {exportError && (
        <div className="tracker-export-error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {exportError}
        </div>
      )}

      {summaryQuery.isLoading ? (
        <div className="tracker-table-card">
          <div className="tracker-loading">
            <div className="tracker-loading-spinner" />
            <div>Loading {roleLabel('TSI')}/{roleLabel('TA')} Dashboard...</div>
          </div>
        </div>
      ) : summaryQuery.isError ? (
        <div className="tracker-table-card">
          <div className="tracker-error">Failed to load {roleLabel('TSI')}/{roleLabel('TA')} Dashboard summary.</div>
        </div>
      ) : data ? (
        <div className="pending-dashboard-tables-container">
          {(() => {
            const query = searchTerm.trim().toLowerCase();

            const hasTsiMatches = query === '' ? true : data.tsiGroups.some((g) => {
              const ownerMatches = g.ownerName.toLowerCase().includes(query);
              return ownerMatches || g.vessels.some((v) => v.vesselName.toLowerCase().includes(query));
            });

            const hasTaMatches = query === '' ? true : data.taGroups.some((g) => {
              const ownerMatches = g.ownerName.toLowerCase().includes(query);
              return ownerMatches || g.vessels.some((v) => v.vesselName.toLowerCase().includes(query));
            });

            const showTsi = (roleFilter === 'ALL' || roleFilter === 'TSI') && hasTsiMatches;
            const showTa = (roleFilter === 'ALL' || roleFilter === 'TA') && hasTaMatches;

            if (query !== '' && !showTsi && !showTa) {
              return (
                <div className="pending-dashboard-empty-card">
                  <div className="pending-empty-content">
                    <div className="empty-icon-circle">
                      <SearchIcon />
                    </div>
                    <h3 className="empty-title">No matching pending records found</h3>
                    <p className="empty-desc">
                      No {roleLabel('TSI')} or {roleLabel('TA')} pending records matched &ldquo;<strong>{searchTerm}</strong>&rdquo;.
                    </p>
                    <button
                      type="button"
                      className="btn-tracker-action btn-tracker-secondary"
                      onClick={() => setSearchTerm('')}
                    >
                      Clear Search
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <>
                {showTsi && (
                  <PendingDashboardTable
                    title={`${roleLabel('TSI')} Pending Overview`}
                    role="TSI"
                    groups={data.tsiGroups}
                    totals={data.tsiTotals}
                    searchFilter={searchTerm}
                    weekLabels={data.weekLabels}
                    onDrillDown={onDrillDown}
                  />
                )}

                {showTa && (
                  <PendingDashboardTable
                    title={`${roleLabel('TA')} Pending Overview`}
                    role="TA"
                    groups={data.taGroups}
                    totals={data.taTotals}
                    searchFilter={searchTerm}
                    weekLabels={data.weekLabels}
                    onDrillDown={onDrillDown}
                  />
                )}
              </>
            );
          })()}
        </div>
      ) : null}

      {isMailModalOpen && (
        <PendingItemsMailModal
          role={roleFilter}
          stage={null}
          mode="dashboard"
          onClose={() => setIsMailModalOpen(false)}
          onSuccess={(msg) => {
            setMailSuccessMessage(msg);
            setTimeout(() => setMailSuccessMessage(null), 8000);
          }}
        />
      )}
    </div>
  );
}
