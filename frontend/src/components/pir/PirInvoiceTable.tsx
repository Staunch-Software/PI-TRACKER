import { useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { PirDepartment, PirEntry, Vessel } from '../../shared';
import { SearchableSelect, type SearchableSelectOption } from '../common/SearchableSelect';
import { formatDate, formatAmount } from '../../lib/format';
import { NO_VESSEL_GROUP } from './PirVesselSidebar';

// SmartPAL's Problematic Invoice Overview — deliberately NOT parameterized at either the
// invoice level or the category level. Both were tested live (2026-09-02) and confirmed broken
// the same way: the URL accepts a query param (?pInvoiceId=.../?pCategoryId=...) but the app's
// own JS ignores it on a fresh navigation and always initializes to the unfiltered default —
// confirmed via network capture that the actual data-fetching call fires with pCategoryId=-1
// (All) regardless of what's in the URL, and the sidebar highlights "All" as active, not the
// requested category. So there is no working deep link to build here at all, category or
// per-invoice — this opens the same generic page every time; see the "Open in SmartPAL"
// tooltip below, deliberately not phrased as if it targets anything specific.
const SMARTPAL_PIR_URL = 'https://smartpal.ozellar.com/AccountsPALApp/Accounts/ProblematicInvoiceOverview';

const DEPARTMENT_LABEL: Record<PirDepartment, string> = {
  TECHNICAL: 'Technical',
  MANNING: 'Manning',
  UNCLASSIFIED: 'Unclassified',
};

const DEPARTMENT_BADGE_STYLE: Record<PirDepartment, CSSProperties> = {
  TECHNICAL: { background: 'var(--color-info-bg)', color: 'var(--color-info)' },
  MANNING: { background: 'var(--color-success-bg)', color: 'var(--color-success)' },
  UNCLASSIFIED: { background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' },
};

// <7d green, 7-14d amber, >14d red — thresholds from the task spec.
function ageBadgeStyle(ageDays: number | null): CSSProperties {
  if (ageDays === null) return { background: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' };
  if (ageDays < 7) return { background: 'var(--color-success-bg)', color: 'var(--color-success)' };
  if (ageDays <= 14) return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' };
  return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)' };
}

interface Props {
  vesselGroup: string;
  items: PirEntry[];
  vessels: Vessel[];
}

// Right pane of the split-view — toolbar (bucket name + count + bulk actions) above a
// sticky-header table. Bulk-select + the bulk "Assign Vessel" action only apply on the
// "No vessel assigned" bucket, since that's the only bucket the per-row assign action itself
// applies to (assigning a vessel to a row that's already matched to a real fleet vessel, or
// already parked in "Not in Fleet" pending a data-quality fix upstream, isn't a case the task
// asked for). Local selection/optimistic-removal state resets automatically when the parent
// remounts this component on vesselGroup change (see PIRPage.tsx's key={vesselGroup}).
export function PirInvoiceTable({ vesselGroup, items, vessels }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isTriageBucket = vesselGroup === NO_VESSEL_GROUP;
  const visibleItems = items.filter((e) => !locallyRemoved.has(e.id));
  const vesselOptions: SearchableSelectOption[] = vessels.map((v) => ({ value: v.id, label: v.name }));

  const assignMutation = useMutation({
    mutationFn: ({ id, vesselId }: { id: string; vesselId: string }) =>
      api.patch<PirEntry>(`/pir-entries/${id}/assign-vessel`, { vesselId }),
    onSuccess: (_data, { id }) => {
      // Optimistic removal — the row belongs to a different bucket now, so drop it from this
      // bucket's view immediately rather than waiting on the refetch (per the task spec).
      setLocallyRemoved((prev) => new Set(prev).add(id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['pir-entries'] });
      queryClient.invalidateQueries({ queryKey: ['pir-kpis'] });
    },
  });

  async function handleBulkAssign(vesselId: string) {
    setBulkError(null);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => assignMutation.mutateAsync({ id, vesselId })));
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : 'Some rows failed to assign — please retry.');
    }
  }

  function toggleAll() {
    if (selectedIds.size === visibleItems.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleItems.map((e) => e.id)));
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="pir-content-pane">
      <div className="pir-pane-toolbar">
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{vesselGroup}</span>
          <span className="pir-sidebar-count">{visibleItems.length}</span>
        </span>
        {isTriageBucket && selectedIds.size > 0 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{selectedIds.size} selected</span>
            <SearchableSelect
              options={vesselOptions}
              value=""
              onChange={handleBulkAssign}
              placeholder="Assign Vessel to Selected"
              disabled={assignMutation.isPending}
            />
          </span>
        )}
      </div>
      {bulkError && (
        <p className="form-error" style={{ margin: '8px 16px 0' }}>
          {bulkError}
        </p>
      )}

      <div className="pir-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {isTriageBucket && (
                <th style={{ textAlign: 'center', width: 36 }}>
                  <input
                    type="checkbox"
                    checked={visibleItems.length > 0 && selectedIds.size === visibleItems.length}
                    onChange={toggleAll}
                  />
                </th>
              )}
              <th style={{ textAlign: 'center' }}>Age</th>
              <th style={{ textAlign: 'center' }}>Data Points</th>
              <th>Invoice No.</th>
              {/* Raw SmartPAL vessel_name, as scraped — distinct from the bucket you're viewing
                  (vesselGroup, the matched/assigned canonical name). Most useful in "No vessel
                  assigned"/"Not in Fleet" specifically: it's the only place left to see what
                  SmartPAL actually had (or didn't) before matching gave up. */}
              <th>Vessel Name (raw)</th>
              <th>Vendor Name</th>
              <th>Vendor Invoice No.</th>
              <th>PO No.</th>
              <th>Reg. Date</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Currency</th>
              <th>Department</th>
              <th>Resolved</th>
              {isTriageBucket && <th>Assign Vessel</th>}
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={isTriageBucket ? 14 : 12} style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  No invoices in this bucket.
                </td>
              </tr>
            )}
            {visibleItems.map((e) => (
              <tr key={e.id}>
                {isTriageBucket && (
                  <td style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleOne(e.id)} />
                  </td>
                )}
                <td style={{ textAlign: 'center' }}>
                  <span className="age-badge" style={ageBadgeStyle(e.ageDays)}>
                    {e.ageDays === null ? '—' : `${e.ageDays}d`}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {e.availableDataPoints ?? '—'}/{e.totalDatapoints ?? '—'}
                </td>
                <td>
                  {e.invoiceNo ? (
                    <a
                      href={SMARTPAL_PIR_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Opens SmartPAL's Problematic Invoice Overview — not a direct link to this invoice (SmartPAL doesn't expose one); you'll need to search for it there."
                    >
                      {e.invoiceNo}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{e.vesselName ?? '—'}</td>
                <td>{e.vendorName ?? '—'}</td>
                <td>{e.vendorInvoiceNo ?? '—'}</td>
                <td>{e.poNos ?? '—'}</td>
                <td>{formatDate(e.regDate)}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatAmount(e.amount)}</td>
                <td>{e.currencyCode ?? '—'}</td>
                <td>
                  <span
                    className="status-badge"
                    style={{ ...DEPARTMENT_BADGE_STYLE[e.department], fontSize: 12, padding: '3px 10px' }}
                  >
                    {DEPARTMENT_LABEL[e.department]}
                  </span>
                </td>
                <td>{e.resolvedAt ? formatDate(e.resolvedAt) : '—'}</td>
                {isTriageBucket && (
                  <td>
                    <SearchableSelect
                      options={vesselOptions}
                      value=""
                      onChange={(vesselId) => assignMutation.mutate({ id: e.id, vesselId })}
                      placeholder="Assign vessel"
                      disabled={assignMutation.isPending}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
