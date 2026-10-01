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
import { ColumnFilterMenu } from '../table/ColumnFilterMenu';
import { ColumnValueFilter, type ColumnValueFilterValue } from '../table/ColumnValueFilter';

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

// Smallest width at which each column's header (label + sort arrow + filter icon) fits cleanly.
const MIN_HEADER_WIDTH: Record<PirColumnKey, number> = {
  age: 110,
  dataPoints: 125,
  invoiceNo: 125,
  vesselNameRaw: 125,
  vendorName: 125,
  vendorInvoiceNo: 130,
  poNos: 115,
  regDate: 125,
  amount: 130,
  currency: 135,
  department: 160,
  resolved: 135,
};

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

// Header filters live in PIRPage (not here) so they survive switching vessel buckets, which
// remounts this component. Every filter is applied client-side to the rows already loaded for
// the bucket, so no backend change is needed.
export interface PirColumnFilters {
  text: Record<string, string>;
  ranges: Record<string, { from: string; to: string }>;
  multi: Record<string, string[]>;
}

export const EMPTY_PIR_COLUMN_FILTERS: PirColumnFilters = { text: {}, ranges: {}, multi: {} };

const NO_VALUE = '—';

type ColumnFilterSpec =
  | { kind: 'text'; get: (e: PirEntry) => string | null | undefined }
  | { kind: 'number'; get: (e: PirEntry) => number | string | null | undefined }
  | { kind: 'date'; get: (e: PirEntry) => string | null | undefined }
  | { kind: 'multi'; get: (e: PirEntry) => string };

const PIR_FILTERS: Record<PirColumnKey, ColumnFilterSpec> = {
  age: { kind: 'number', get: (e) => e.ageDays },
  dataPoints: { kind: 'number', get: (e) => e.availableDataPoints },
  invoiceNo: { kind: 'text', get: (e) => e.invoiceNo },
  vesselNameRaw: { kind: 'text', get: (e) => e.vesselName },
  vendorName: { kind: 'text', get: (e) => e.vendorName },
  vendorInvoiceNo: { kind: 'text', get: (e) => e.vendorInvoiceNo },
  poNos: { kind: 'text', get: (e) => e.poNos },
  regDate: { kind: 'date', get: (e) => e.regDate },
  amount: { kind: 'number', get: (e) => e.amount },
  currency: { kind: 'multi', get: (e) => e.currencyCode ?? NO_VALUE },
  department: { kind: 'multi', get: (e) => e.department },
  resolved: { kind: 'date', get: (e) => e.resolvedAt },
};

function matchesColumnFilters(e: PirEntry, filters: PirColumnFilters): boolean {
  for (const key of Object.keys(PIR_FILTERS) as PirColumnKey[]) {
    const spec = PIR_FILTERS[key];
    if (spec.kind === 'text') {
      const needle = filters.text[key]?.trim().toLowerCase();
      if (needle && !(spec.get(e) ?? '').toLowerCase().includes(needle)) return false;
    } else if (spec.kind === 'multi') {
      const selected = filters.multi[key];
      if (selected?.length && !selected.includes(spec.get(e))) return false;
    } else {
      const range = filters.ranges[key];
      if (!range || (!range.from && !range.to)) continue;
      const raw = spec.get(e);
      if (raw === null || raw === undefined || raw === '') return false;
      if (spec.kind === 'date') {
        const day = String(raw).slice(0, 10);
        if (range.from && day < range.from) return false;
        if (range.to && day > range.to) return false;
      } else {
        const n = Number(raw);
        if (range.from !== '' && n < Number(range.from)) return false;
        if (range.to !== '' && n > Number(range.to)) return false;
      }
    }
  }
  return true;
}

// Overall (all-columns) search for the table toolbar — matches against what each column shows.
function matchesTableSearch(e: PirEntry, needle: string): boolean {
  const haystack = [
    e.ageDays,
    e.availableDataPoints !== null && e.totalDatapoints !== null ? `${e.availableDataPoints}/${e.totalDatapoints}` : null,
    e.invoiceNo,
    e.vesselName,
    e.vendorName,
    e.vendorInvoiceNo,
    e.poNos,
    formatDate(e.regDate),
    formatAmount(e.amount),
    e.currencyCode,
    DEPARTMENT_LABEL[e.department],
    e.resolvedAt ? formatDate(e.resolvedAt) : null,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

// Empty values always sort last, in both directions.
function sortEntries(rows: PirEntry[], key: PirColumnKey, dir: 'asc' | 'desc'): PirEntry[] {
  const spec = PIR_FILTERS[key];
  const mult = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = spec.get(a);
    const bv = spec.get(b);
    const aEmpty = av === null || av === undefined || av === '';
    const bEmpty = bv === null || bv === undefined || bv === '';
    if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    if (spec.kind === 'number') return (Number(av) - Number(bv)) * mult;
    if (spec.kind === 'date') return String(av).slice(0, 10).localeCompare(String(bv).slice(0, 10)) * mult;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * mult;
  });
}

interface Props {
  vesselGroup: string;
  items: PirEntry[];
  vessels: Vessel[];
  columnOrder: PirColumnKey[];
  columnWidths: Record<string, number>;
  layoutEditable: boolean;
  onReorderColumn: (newOrder: PirColumnKey[]) => void;
  onResizeColumn: (key: PirColumnKey, width: number) => void;
  columnFilters: PirColumnFilters;
  onColumnFiltersChange: (next: PirColumnFilters) => void;
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
  columnFilters,
  onColumnFiltersChange,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const isTriageBucket = vesselGroup === NO_VESSEL_GROUP;
  const [tableSearch, setTableSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PirColumnKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const needle = tableSearch.trim().toLowerCase();
  const filteredItems = items.filter(
    (e) => !locallyRemoved.has(e.id) && matchesColumnFilters(e, columnFilters) && (!needle || matchesTableSearch(e, needle))
  );
  const visibleItems = sortKey ? sortEntries(filteredItems, sortKey, sortDir) : filteredItems;

  // Exports exactly the rows on screen — the selected sidebar bucket (this component only ever
  // receives that bucket's rows), the page-level tabs/search, the column filters and the table
  // search — in the current sort order. The backend adds every other stored detail per row.
  async function handleExport() {
    setExportError(null);
    setIsExporting(true);
    try {
      const res = await fetch('/api/pir-entries/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: visibleItems.map((e) => e.id) }),
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          message = (await res.json()).detail ?? message;
        } catch {
          // no JSON body
        }
        throw new ApiError(res.status, typeof message === 'string' ? message : 'Failed to export.');
      }
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="?([^"]+)"?/)?.[1] ?? 'PIR_Export.xlsx';
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to export.');
    } finally {
      setIsExporting(false);
    }
  }

  // Header clicks cycle ascending -> descending -> unsorted (default order) -> ascending.
  // Clicking a different header starts over at ascending.
  function handleSort(key: PirColumnKey) {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        // Third click: drop the sort and return to the default order.
        setSortKey(null);
        setSortDir('asc');
      }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // Options for the dropdown-style filters. Department is a fixed set; Currency is whatever
  // appears in this bucket's rows.
  const multiOptions: Partial<Record<PirColumnKey, { value: string; label: string }[]>> = {
    department: (Object.keys(DEPARTMENT_LABEL) as PirDepartment[]).map((d) => ({ value: d, label: DEPARTMENT_LABEL[d] })),
    currency: Array.from(new Set(items.map((e) => e.currencyCode ?? NO_VALUE)))
      .sort()
      .map((c) => ({ value: c, label: c })),
  };

  function setValueFilter(key: PirColumnKey, kind: 'text' | 'range', v: ColumnValueFilterValue) {
    if (kind === 'text') {
      onColumnFiltersChange({ ...columnFilters, text: { ...columnFilters.text, [key]: v.text ?? '' } });
    } else {
      onColumnFiltersChange({
        ...columnFilters,
        ranges: { ...columnFilters.ranges, [key]: { from: v.from ?? '', to: v.to ?? '' } },
      });
    }
  }
  const vesselOptions: SearchableSelectOption[] = vessels.map((v) => ({ value: v.id, label: v.name }));

  const draggedKeyRef = useRef<PirColumnKey | null>(null);
  const resizeStateRef = useRef<{ key: PirColumnKey; startX: number; startWidth: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<PirColumnKey | null>(null);

  // A column is never rendered narrower than its header needs (longest word + sort arrow +
  // filter icon + padding), so the header controls can't overlap the label — even if a narrower
  // width was saved earlier.
  function effectiveWidth(key: PirColumnKey): number {
    return Math.max(columnWidths[key] ?? DEFAULT_PIR_COL_WIDTHS[key], MIN_HEADER_WIDTH[key]);
  }

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
    const startWidth = effectiveWidth(key);
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
        <input
          type="search"
          className="pir-table-search"
          placeholder="Search this table…"
          value={tableSearch}
          onChange={(ev) => setTableSearch(ev.target.value)}
        />
        <button
          type="button"
          className="pir-layout-btn pir-export-btn"
          onClick={handleExport}
          disabled={isExporting || visibleItems.length === 0}
          title="Export the rows currently shown to Excel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {isExporting ? 'Exporting…' : 'Export to Excel'}
        </button>
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
      {exportError && (
        <p className="form-error" style={{ margin: '8px 16px 0' }}>
          {exportError}
        </p>
      )}
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
              <col key={key} style={{ width: effectiveWidth(key) }} />
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
                  !layoutEditable ? 'col-has-filter' : undefined,
                  !layoutEditable ? 'sortable-col' : undefined,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <th
                    key={key}
                    className={classNames || undefined}
                    style={{ textAlign: def.align }}
                    onClick={!layoutEditable ? () => handleSort(key) : undefined}
                    draggable={layoutEditable}
                    onDragStart={layoutEditable ? () => handleDragStart(key) : undefined}
                    onDragOver={layoutEditable ? (e) => handleDragOver(key, e) : undefined}
                    onDrop={layoutEditable ? () => handleDrop(key) : undefined}
                    onDragEnd={layoutEditable ? handleDragEnd : undefined}
                  >
                    <div
                      className="pir-th-inner"
                      style={{ justifyContent: def.align === 'center' ? 'center' : def.align === 'right' ? 'flex-end' : 'flex-start' }}
                    >
                    <span className="pir-th-label">{def.label}</span>
                    {!layoutEditable && (
                      <span className="sort-arrow">{sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                    )}
                    {!layoutEditable && (() => {
                      const spec = PIR_FILTERS[key];
                      if (spec.kind === 'multi') {
                        return (
                          <ColumnFilterMenu
                            options={multiOptions[key] ?? []}
                            selected={columnFilters.multi[key] ?? []}
                            onChange={(values) =>
                              onColumnFiltersChange({ ...columnFilters, multi: { ...columnFilters.multi, [key]: values } })
                            }
                          />
                        );
                      }
                      const isText = spec.kind === 'text';
                      return (
                        <ColumnValueFilter
                          kind={spec.kind}
                          value={isText ? { text: columnFilters.text[key] ?? '' } : columnFilters.ranges[key] ?? {}}
                          onChange={(v) => setValueFilter(key, isText ? 'text' : 'range', v)}
                        />
                      );
                    })()}
                    </div>
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