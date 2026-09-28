import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
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

// Fixed (non-reorderable, non-resizable) columns — only rendered in the "No vessel assigned" bucket.
const PIR_FIXED_WIDTHS = { select: 44, assign: 170 } as const;

// Default width of every reorderable column — fallback for anything missing from a saved layout.
export const DEFAULT_PIR_COL_WIDTHS = {
  age: 80,
  dataPoints: 90,
  invoiceNo: 130,
  vesselNameRaw: 130,
  vendorName: 140,
  vendorInvoiceNo: 130,
  poNos: 110,
  regDate: 120,
  amount: 110,
  currency: 90,
  department: 120,
  resolved: 110,
} as const;

export type PirColumnKey = keyof typeof DEFAULT_PIR_COL_WIDTHS;

export const DEFAULT_PIR_COLUMN_ORDER = [
  'age', 'dataPoints', 'invoiceNo', 'vesselNameRaw', 'vendorName', 'vendorInvoiceNo',
  'poNos', 'regDate', 'amount', 'currency', 'department', 'resolved',
] as const satisfies readonly PirColumnKey[];

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 1000;

interface PirColumnDef {
  label: string;
  align?: 'center' | 'right';
  cellStyle?: CSSProperties;
  cellTitle?: (e: PirEntry) => string | undefined;
  renderCell: (e: PirEntry) => ReactNode;
}

// One entry per reorderable column (same pattern as COLUMNS in PiEntriesTable.tsx) — header and
// body are rendered from this map by columnOrder, which is what makes drag-to-reorder possible.
const PIR_COLUMNS: Record<PirColumnKey, PirColumnDef> = {
  age: {
    label: 'Age',
    align: 'center',
    renderCell: (e) => (
      <span className="pir-status-badge" style={ageBadgeStyle(e.ageDays)}>
        {e.ageDays === null ? '—' : `${e.ageDays}d`}
      </span>
    ),
  },
  dataPoints: {
    label: 'Data Points',
    align: 'center',
    renderCell: (e) => `${e.availableDataPoints ?? '—'}/${e.totalDatapoints ?? '—'}`,
  },
  invoiceNo: {
    label: 'Invoice No.',
    renderCell: (e) =>
      e.invoiceNo ? (
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
      ),
  },
  // Raw SmartPAL vessel_name, as scraped — distinct from the bucket being viewed.
  vesselNameRaw: {
    label: 'Vessel Name (raw)',
    cellTitle: (e) => e.vesselName ?? undefined,
    renderCell: (e) => e.vesselName ?? '—',
  },
  vendorName: {
    label: 'Vendor Name',
    cellTitle: (e) => e.vendorName ?? undefined,
    renderCell: (e) => e.vendorName ?? '—',
  },
  vendorInvoiceNo: {
    label: 'Vendor Invoice No.',
    cellTitle: (e) => e.vendorInvoiceNo ?? undefined,
    renderCell: (e) => e.vendorInvoiceNo ?? '—',
  },
  poNos: {
    label: 'PO No.',
    cellTitle: (e) => e.poNos ?? undefined,
    renderCell: (e) => e.poNos ?? '—',
  },
  regDate: {
    label: 'Reg. Date',
    renderCell: (e) => formatDate(e.regDate),
  },
  amount: {
    label: 'Amount',
    align: 'right',
    cellStyle: { fontVariantNumeric: 'tabular-nums' },
    renderCell: (e) => formatAmount(e.amount),
  },
  currency: {
    label: 'Currency',
    renderCell: (e) => e.currencyCode ?? '—',
  },
  department: {
    label: 'Department',
    renderCell: (e) => (
      <span className="pir-status-badge" style={{ ...DEPARTMENT_BADGE_STYLE[e.department] }}>
        {DEPARTMENT_LABEL[e.department]}
      </span>
    ),
  },
  resolved: {
    label: 'Resolved',
    renderCell: (e) => (e.resolvedAt ? formatDate(e.resolvedAt) : '—'),
  },
};

interface Props {
  vesselGroup: string;
  items: PirEntry[];
  vessels: Vessel[];
  columnOrder: PirColumnKey[];
  columnWidths: Record<string, number>;
  layoutEditable: boolean;
  onReorderColumn: (newOrder: PirColumnKey[]) => void;
  onResizeColumn: (key: PirColumnKey, width: number) => void;
}

// Right pane of the split-view — toolbar (bucket name + count + bulk actions) above a
// sticky-header table. Bulk-select + the bulk "Assign Vessel" action only apply on the
// "No vessel assigned" bucket, since that's the only bucket the per-row assign action itself
// applies to (assigning a vessel to a row that's already matched to a real fleet vessel, or
// already parked in "Not in Fleet" pending a data-quality fix upstream, isn't a case the task
// asked for). Local selection/optimistic-removal state resets automatically when the parent
// remounts this component on vesselGroup change (see PIRPage.tsx's key={vesselGroup}).
export function PirInvoiceTable({
  vesselGroup,
  items,
  vessels,
  columnOrder,
  columnWidths,
  layoutEditable,
  onReorderColumn,
  onResizeColumn,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isTriageBucket = vesselGroup === NO_VESSEL_GROUP;
  const visibleItems = items.filter((e) => !locallyRemoved.has(e.id));
  const vesselOptions: SearchableSelectOption[] = vessels.map((v) => ({ value: v.id, label: v.name }));

  const draggedKeyRef = useRef<PirColumnKey | null>(null);
  const resizeStateRef = useRef<{ key: PirColumnKey; startX: number; startWidth: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<PirColumnKey | null>(null);

  function handleDragStart(key: PirColumnKey) {
    draggedKeyRef.current = key;
  }

  function handleDragOver(key: PirColumnKey, e: DragEvent) {
    e.preventDefault();
    if (draggedKeyRef.current && draggedKeyRef.current !== key) {
      setDragOverKey(key);
    }
  }

  function handleDrop(targetKey: PirColumnKey) {
    const draggedKey = draggedKeyRef.current;
    draggedKeyRef.current = null;
    setDragOverKey(null);
    if (!draggedKey || draggedKey === targetKey) return;
    const next = columnOrder.filter((k) => k !== draggedKey);
    const targetIndex = next.indexOf(targetKey);
    next.splice(targetIndex, 0, draggedKey);
    onReorderColumn(next);
  }

  function handleDragEnd() {
    draggedKeyRef.current = null;
    setDragOverKey(null);
  }

  function handleResizeStart(key: PirColumnKey, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = columnWidths[key] ?? DEFAULT_PIR_COL_WIDTHS[key];
    resizeStateRef.current = { key, startX: e.clientX, startWidth };

    function onMove(moveEvent: MouseEvent) {
      const state = resizeStateRef.current;
      if (!state) return;
      const nextWidth = Math.min(
        MAX_COL_WIDTH,
        Math.max(MIN_COL_WIDTH, state.startWidth + (moveEvent.clientX - state.startX))
      );
      onResizeColumn(state.key, nextWidth);
    }
    function onUp() {
      resizeStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

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
          <colgroup>
            {isTriageBucket && <col style={{ width: PIR_FIXED_WIDTHS.select }} />}
            {columnOrder.map((key) => (
              <col key={key} style={{ width: columnWidths[key] ?? DEFAULT_PIR_COL_WIDTHS[key] }} />
            ))}
            {isTriageBucket && <col style={{ width: PIR_FIXED_WIDTHS.assign }} />}
          </colgroup>
          <thead>
            <tr>
              {isTriageBucket && (
                <th style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={visibleItems.length > 0 && selectedIds.size === visibleItems.length}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columnOrder.map((key) => {
                const def = PIR_COLUMNS[key];
                const classNames = [
                  layoutEditable ? 'col-layout-editable' : undefined,
                  dragOverKey === key ? 'col-drag-over' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <th
                    key={key}
                    className={classNames || undefined}
                    style={{ textAlign: def.align }}
                    draggable={layoutEditable}
                    onDragStart={layoutEditable ? () => handleDragStart(key) : undefined}
                    onDragOver={layoutEditable ? (e) => handleDragOver(key, e) : undefined}
                    onDrop={layoutEditable ? () => handleDrop(key) : undefined}
                    onDragEnd={layoutEditable ? handleDragEnd : undefined}
                  >
                    {def.label}
                    {layoutEditable && (
                      <span
                        className="col-resize-handle"
                        onMouseDown={(e) => handleResizeStart(key, e)}
                        title="Drag to resize"
                      />
                    )}
                  </th>
                );
              })}
              {isTriageBucket && <th>Assign Vessel</th>}
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 && (
              <tr>
                <td
                  colSpan={columnOrder.length + (isTriageBucket ? 2 : 0)}
                  style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}
                >
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
                {columnOrder.map((key) => {
                  const def = PIR_COLUMNS[key];
                  return (
                    <td key={key} title={def.cellTitle?.(e)} style={{ textAlign: def.align, ...def.cellStyle }}>
                      {def.renderCell(e)}
                    </td>
                  );
                })}
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