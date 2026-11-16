import { useEffect, useRef, useState, type DragEvent, type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from 'react';
import type { DdTrackerEntry, DdTrackerFilterOptions } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import { SearchableSelect } from '../common/SearchableSelect';
import { PrPoLookupInput } from './PrPoLookupInput';
import type { DdTrackerFormState } from './ddTrackerForm';
import { ColumnFilterMenu } from '../table/ColumnFilterMenu';
import { ColumnValueFilter } from '../table/ColumnValueFilter';

// Same sticky-column split as PiEntriesTable/LandingReportsTable: an Actions column (a per-row
// select checkbox, used for bulk delete via the toolbar's "Delete Selected"; Save/Cancel while
// adding a new row) pinned first, then S.No. There's still no row-level Edit button —
// double-clicking an editable cell edits just that cell, with its own inline auto-save (see
// DdTrackerPage). Vessel is also not a column — it's filtered via the capsule row above the table
// instead.
const STICKY_COL_WIDTHS = {
  sno: 80,
} as const;

// '' maps to the "—" clear-the-field option on both dropdowns.
const ENTRY_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'DD', label: 'DD' },
  { value: 'OPEX', label: 'OPEX' },
  { value: 'NB', label: 'NB' },
  { value: 'PD', label: 'PD' },
];
const INVOICE_TYPE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'Tax Invoice', label: 'Tax Invoice' },
  { value: 'Proforma Invoice', label: 'Proforma Invoice' },
];

export const DEFAULT_COL_WIDTHS = {
  entryType: 110,
  prNumber: 170,
  prStatus: 180,
  poNumber: 170,
  poStatus: 150,
  title: 320,
  vendor: 220,
  poAmount: 130,
  poCurrency: 100,
  supplyPort: 160,
  orderStatus: 220,
  leadDays: 110,
  readinessDate: 150,
  exStock: 130,
  supplyConfirmation: 180,
  remarks: 260,
  invoiceNumber: 160,
  invoiceType: 160,
  invoiceAmount: 140,
  invoiceCurrency: 110,
  invoiceStatus: 150,
  paymentStatus: 160,
} as const;

export type ReorderableColumnKey = keyof typeof DEFAULT_COL_WIDTHS;

// Grouped by category (see each column's `group` in COLUMNS below) so the default layout matches
// the 2-row grouped header without any column needing to jump around — General, then Requisition,
// Purchase Order, Tracking (the team's own manual follow-up fields), Invoice.
export const DEFAULT_COLUMN_ORDER = [
  'entryType', 'title',
  'prNumber', 'prStatus',
  'poNumber', 'poStatus', 'vendor', 'poAmount', 'poCurrency', 'supplyPort',
  'orderStatus', 'leadDays', 'readinessDate', 'exStock', 'supplyConfirmation', 'remarks',
  'invoiceNumber', 'invoiceType', 'invoiceAmount', 'invoiceCurrency', 'invoiceStatus', 'paymentStatus',
] as const satisfies readonly ReorderableColumnKey[];

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 1000;

export type SortColumn = 'seqNo' | 'vesselName' | 'entryType' | 'requisitionNo' | 'poNo' | 'readinessDate';

// One field per filterable column (added to 2026-11-11 for PR/PO Status, Vendor, Supply Port,
// Order/Delivery Status, Remarks, Invoice Type/Status, Payment Status, on top of the original 4).
// Keyed by column key (not by the backend's query-param name, which sometimes differs — e.g.
// this column is `supplyConfirmation`, the query param is `delivery_status`; DdTrackerPage's own
// buildQueryParams is where that translation happens).
export interface DdTrackerColumnFilters {
  entryType: string[];
  requisitionNo: string;
  poNo: string;
  readinessDate: { from: string; to: string };
  prStatus: string[];
  poStatus: string[];
  vendor: string[];
  supplyPort: string;
  orderStatus: string[];
  supplyConfirmation: string[];
  remarks: string;
  invoiceType: string[];
  invoiceStatus: string[];
  paymentStatus: string[];
}

interface EditCellCtx {
  form: DdTrackerFormState;
  onChange: (field: keyof DdTrackerFormState, value: string) => void;
  // Only meaningful for immediateCommit columns (see ColumnDef) — picking a dropdown value saves
  // it right away instead of waiting for a separate Save click, since choosing from a short fixed
  // list is already the complete action (unlike a text field, where you might still be typing).
  onSelectAndSave: (field: keyof DdTrackerFormState, value: string) => void;
  // Wired to SearchableSelect's own onClose — fires exactly when its option panel actually closes,
  // whether that's from picking a value (onChange already ran first, synchronously, so the save is
  // already in flight by the time this fires) or a genuine click-away. Using this instead of this
  // cell's own onBlur sidesteps a real bug: SearchableSelect's panel renders through a React portal
  // into document.body, so focus moving into/around it never looks like a descendant of this
  // cell's wrapping div, and a relatedTarget/blur-based guard kept mistaking normal dropdown
  // interaction (opening it, clicking an option) for "clicked away" and closing the cell before
  // the user could pick anything.
  onClose: () => void;
}

// The 2nd header row's group label — same contiguous blocks as DEFAULT_COLUMN_ORDER above.
// Reordering columns in Edit Layout can split a group across more than one header span (see
// computeGroupSpans) if the user drags one of its columns elsewhere; that's a visual
// consequence of letting columns move freely, not a bug.
type ColumnGroup = 'General' | 'Requisition' | 'Purchase Order' | 'Tracking' | 'Invoice';

interface ColumnDef {
  label: string;
  group: ColumnGroup;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (entry: DdTrackerEntry) => ReactNode;
  // Omitted for columns sourced live from the SmartPAL scrape (PR/PO status, vendor, amount,
  // supply port) or computed (Lead Days) — those are never editable, double-click does nothing.
  renderEditCell?: (ctx: EditCellCtx) => ReactNode;
  // Dropdown columns (Type, Invoice Type): no inline Save/Cancel at all — selecting an option
  // commits immediately via onSelectAndSave.
  immediateCommit?: boolean;
  // Column-header sort + Excel-style filter, added 2026-11-11 — deliberately only on the columns
  // backend/app/api/routes/dd_tracker.py's _SORTABLE_COLUMNS already covers (plain DdTrackerEntry
  // fields); the PR/PO/invoice-derived columns are display-only here, same as their lack of
  // renderEditCell above.
  sortColumn?: SortColumn;
  filter?: { kind: 'multi'; options: { value: string; label: string }[] } | { kind: 'text' } | { kind: 'date' };
}

const COLUMNS: Record<ReorderableColumnKey, ColumnDef> = {
  entryType: {
    label: 'Type',
    group: 'General',
    renderCell: (e) => e.entryType ?? '—',
    immediateCommit: true,
    renderEditCell: ({ form, onSelectAndSave, onClose }) => (
      <SearchableSelect options={ENTRY_TYPE_OPTIONS} value={form.entryType} onChange={(v) => onSelectAndSave('entryType', v)} onClose={onClose} />
    ),
    sortColumn: 'entryType',
    filter: { kind: 'multi', options: ENTRY_TYPE_OPTIONS.filter((o) => o.value) },
  },
  prNumber: {
    label: 'PR Number',
    group: 'Requisition',
    renderCell: (e) => e.requisitionNo ?? '—',
    sortColumn: 'requisitionNo',
    filter: { kind: 'text' },
    renderEditCell: ({ form, onChange }) => (
      <PrPoLookupInput
        kind="pr"
        autoFocus
        value={form.requisitionNo}
        onChange={(v) => onChange('requisitionNo', v)}
        onPick={(r) => {
          onChange('requisitionNo', r.requisitionNo);
          onChange('vesselName', r.vesselName ?? '');
          onChange('title', r.title ?? '');
        }}
      />
    ),
  },
  prStatus: {
    label: 'PR Status',
    group: 'Requisition',
    renderCell: (e) => e.prStatusLive ?? '—',
    // Dynamic multi-select — real options come from DdTrackerPage's filterOptions query (distinct
    // live-computed values), not a static list here; see renderHeaderCell below.
    filter: { kind: 'multi', options: [] },
  },
  poNumber: {
    label: 'PO Number',
    group: 'Purchase Order',
    renderCell: (e) => e.poNo ?? '—',
    sortColumn: 'poNo',
    filter: { kind: 'text' },
    renderEditCell: ({ form, onChange }) => (
      <PrPoLookupInput
        kind="po"
        autoFocus
        value={form.poNo}
        onChange={(v) => onChange('poNo', v)}
        onPick={(r) => {
          onChange('poNo', r.poNo);
          onChange('vesselName', r.vesselName ?? '');
          onChange('title', r.title ?? '');
        }}
      />
    ),
  },
  poStatus: {
    label: 'PO Status',
    group: 'Purchase Order',
    renderCell: (e) => e.poApprovedStatus ?? '—',
    filter: { kind: 'multi', options: [] },
  },
  title: {
    label: 'Title',
    group: 'General',
    cellClassName: 'col-left',
    renderCell: (e) => e.title ?? e.poTitle ?? e.prTitle ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.title} onChange={(ev) => onChange('title', ev.target.value)} />
    ),
  },
  vendor: {
    label: 'Vendor',
    group: 'Purchase Order',
    renderCell: (e) => e.poVendor ?? '—',
    filter: { kind: 'multi', options: [] },
  },
  poAmount: {
    label: 'PO Amount',
    group: 'Purchase Order',
    headerClassName: 'col-right',
    cellClassName: 'col-right',
    renderCell: (e) => formatAmount(e.poBaseAmount),
  },
  poCurrency: {
    label: 'PO Currency',
    group: 'Purchase Order',
    renderCell: (e) => e.poBaseCurrency ?? '—',
  },
  supplyPort: {
    label: 'Supply Port',
    group: 'Purchase Order',
    renderCell: (e) => e.poSchdDelPort ?? '—',
    filter: { kind: 'text' },
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.supplyPort} onChange={(ev) => onChange('supplyPort', ev.target.value)} />
    ),
  },
  orderStatus: {
    label: 'Order Status',
    group: 'Tracking',
    renderCell: (e) => e.orderStatus ?? '—',
    filter: { kind: 'multi', options: [] },
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.orderStatus} onChange={(ev) => onChange('orderStatus', ev.target.value)} />
    ),
  },
  leadDays: {
    label: 'Lead Days',
    group: 'Tracking',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    // Computed server-side as (readinessDate - poApprovedDate) — never editable, see
    // backend/app/api/routes/dd_tracker.py.
    renderCell: (e) => e.leadDays ?? '—',
  },
  readinessDate: {
    label: 'Readiness Date',
    group: 'Tracking',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (e) => formatDate(e.readinessDate),
    sortColumn: 'readinessDate',
    filter: { kind: 'date' },
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus type="date" value={form.readinessDate} onChange={(ev) => onChange('readinessDate', ev.target.value)} />
    ),
  },
  exStock: {
    label: 'Ex-Stock',
    group: 'Tracking',
    renderCell: (e) => e.exStock ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.exStock} onChange={(ev) => onChange('exStock', ev.target.value)} />
    ),
  },
  supplyConfirmation: {
    label: 'Delivery Status',
    group: 'Tracking',
    renderCell: (e) => e.supplyConfirmation ?? '—',
    filter: { kind: 'multi', options: [] },
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.supplyConfirmation} onChange={(ev) => onChange('supplyConfirmation', ev.target.value)} />
    ),
  },
  remarks: {
    label: 'Remarks',
    group: 'Tracking',
    renderCell: (e) => e.remarks ?? '—',
    filter: { kind: 'text' },
    renderEditCell: ({ form, onChange }) => (
      <input autoFocus value={form.remarks} onChange={(ev) => onChange('remarks', ev.target.value)} />
    ),
  },
  // Invoice Number/Amount/Currency/Status are live-joined from smartpal_invoice_entries by PO
  // number (see backend/app/api/routes/dd_tracker.py) — never editable here, same stance as
  // Vendor/PO Amount/Supply Port. Only Invoice Type stays manual (no equivalent live field — see
  // dd_tracker_entry.py docstring).
  invoiceNumber: {
    label: 'Invoice Number',
    group: 'Invoice',
    renderCell: (e) => e.invoiceNumber ?? '—',
  },
  invoiceType: {
    label: 'Invoice Type',
    group: 'Invoice',
    renderCell: (e) => e.invoiceType ?? '—',
    immediateCommit: true,
    filter: { kind: 'multi', options: [] },
    renderEditCell: ({ form, onSelectAndSave, onClose }) => (
      <SearchableSelect options={INVOICE_TYPE_OPTIONS} value={form.invoiceType} onChange={(v) => onSelectAndSave('invoiceType', v)} onClose={onClose} />
    ),
  },
  invoiceAmount: {
    label: 'Invoice Amount',
    group: 'Invoice',
    headerClassName: 'col-right',
    cellClassName: 'col-right',
    renderCell: (e) => formatAmount(e.invoiceAmount),
  },
  invoiceCurrency: {
    label: 'Invoice Currency',
    group: 'Invoice',
    renderCell: (e) => e.invoiceCurrency ?? '—',
  },
  invoiceStatus: {
    label: 'Invoice Status',
    group: 'Invoice',
    renderCell: (e) => e.invoiceStatus ?? '—',
    filter: { kind: 'multi', options: [] },
  },
  // Live-joined from smartpal_invoice_entries.paid_status (see backend/app/api/routes/dd_tracker.py)
  // — never editable here, same stance as Invoice Number/Amount/Currency/Status.
  paymentStatus: {
    label: 'Payment Status',
    group: 'Invoice',
    renderCell: (e) => e.paymentStatus ?? '—',
    filter: { kind: 'multi', options: [] },
  },
};

// Maps a column key to its DdTrackerColumnFilters field — not always the same name (prNumber's
// filter field is requisitionNo, poNumber's is poNo) since the column key follows this table's own
// naming while the filter field follows the backend query param it feeds (see DdTrackerPage).
const COLUMN_FILTER_FIELD: Partial<Record<ReorderableColumnKey, keyof DdTrackerColumnFilters>> = {
  entryType: 'entryType',
  prNumber: 'requisitionNo',
  prStatus: 'prStatus',
  poNumber: 'poNo',
  poStatus: 'poStatus',
  vendor: 'vendor',
  supplyPort: 'supplyPort',
  orderStatus: 'orderStatus',
  readinessDate: 'readinessDate',
  supplyConfirmation: 'supplyConfirmation',
  remarks: 'remarks',
  invoiceType: 'invoiceType',
  invoiceStatus: 'invoiceStatus',
  paymentStatus: 'paymentStatus',
};

// Which distinct-value list a 'multi' filter column reads from the /dd-tracker/filter-options
// response — only the live-computed columns need this (entryType/invoiceType's options are a
// small static list defined above instead, since those are this app's own fixed enum values, not
// something read live off SmartPAL).
const COLUMN_FILTER_OPTIONS_KEY: Partial<Record<ReorderableColumnKey, keyof DdTrackerFilterOptions>> = {
  prStatus: 'prStatus',
  poStatus: 'poStatus',
  vendor: 'vendor',
  orderStatus: 'orderStatus',
  supplyConfirmation: 'deliveryStatus',
  invoiceStatus: 'invoiceStatus',
  paymentStatus: 'paymentStatus',
};

function isLastColumnOfGroup(index: number, order: ReorderableColumnKey[]): boolean {
  if (index === order.length - 1) return false;
  return COLUMNS[order[index]].group !== COLUMNS[order[index + 1]].group;
}

function renderGroupIcon(group: ColumnGroup) {
  switch (group) {
    case 'General':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      );
    case 'Requisition':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      );
    case 'Purchase Order':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      );
    case 'Tracking':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      );
    case 'Invoice':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
          <line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      );
  }
}

interface Props {
  entries: DdTrackerEntry[];
  page: number;
  pageSize: number;
  canEdit: boolean;
  sortBy: SortColumn | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;

  // Excel-style per-column filters — one object instead of a prop pair per column now that this
  // covers 14 of them (added to 2026-11-11 per direct purchaser feedback). See DdTrackerPage for
  // how these feed into the list/export query params, and DdTrackerColumnFilters for the shape.
  filters: DdTrackerColumnFilters;
  onFilterChange: <K extends keyof DdTrackerColumnFilters>(key: K, value: DdTrackerColumnFilters[K]) => void;
  // Distinct values for the live-computed columns' multi-select filters (PR/PO Status, Vendor,
  // Order/Delivery Status, Invoice Type/Status, Payment Status) — fetched once from
  // /dd-tracker/filter-options, not derived from whatever's currently on screen, so narrowing one
  // filter never shrinks another's choices. Supply Port and Remarks are free-text instead (no
  // bounded option list), same reasoning as PR/PO Number.
  filterOptions: DdTrackerFilterOptions;

  // Cell-level editing: editingId identifies the row, editingField identifies which single cell
  // in it is showing an input right now. editForm holds the whole row's current values (prefilled
  // when editing starts) so switching which field is active within the same row never loses an
  // edit already made to another field — Save commits all of it in one PATCH.
  editingId: string | null;
  editingField: ReorderableColumnKey | null;
  editForm: DdTrackerFormState | null;
  isSavingEdit: boolean;
  onStartCellEdit: (entry: DdTrackerEntry, field: ReorderableColumnKey) => void;
  onEditFormChange: (field: keyof DdTrackerFormState, value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSelectAndSave: (field: keyof DdTrackerFormState, value: string) => void;

  isAddingNew: boolean;
  newRowForm: DdTrackerFormState;
  isSavingNew: boolean;
  onNewRowChange: (field: keyof DdTrackerFormState, value: string) => void;
  onSaveNew: () => void;
  onCancelNew: () => void;

  // Checkbox multi-select for bulk delete (see DdTrackerPage) — selectedIds is keyed by entry.id,
  // scoped to whatever's currently loaded (i.e. the current page), same as PirInvoiceTable's own
  // selection pattern.
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;

  columnOrder: ReorderableColumnKey[];
  columnWidths: Record<string, number>;
  layoutEditable: boolean;
  onReorderColumn: (newOrder: ReorderableColumnKey[]) => void;
  onResizeColumn: (key: ReorderableColumnKey, width: number) => void;
}

export function DdTrackerTable({
  entries,
  page,
  pageSize,
  canEdit,
  sortBy,
  sortDir,
  onSort,
  filters,
  onFilterChange,
  filterOptions,
  editingId,
  editingField,
  editForm,
  isSavingEdit,
  onStartCellEdit,
  onEditFormChange,
  onSaveEdit,
  onCancelEdit,
  onSelectAndSave,
  isAddingNew,
  newRowForm,
  isSavingNew,
  onNewRowChange,
  onSaveNew,
  onCancelNew,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  columnOrder,
  columnWidths,
  layoutEditable,
  onReorderColumn,
  onResizeColumn,
}: Props) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const draggedKeyRef = useRef<ReorderableColumnKey | null>(null);
  const resizeStateRef = useRef<{ key: ReorderableColumnKey; startX: number; startWidth: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<ReorderableColumnKey | null>(null);
  // Enter/Escape already call onSaveEdit/onCancelEdit explicitly — both also cause the cell's
  // input to lose focus a moment later (Escape unmounts the cell, Enter often blurs natively),
  // which would otherwise fire onBlur's own save a second time (harmless but wasteful for Enter,
  // and would wrongly re-save over a cancel for Escape). Suppresses exactly that one follow-up
  // blur.
  const suppressBlurRef = useRef(false);

  function syncHeaderScroll(e: UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) {
      const gutter = e.currentTarget.offsetWidth - e.currentTarget.clientWidth;
      if (headerScrollRef.current.style.paddingRight !== `${gutter}px`) {
        headerScrollRef.current.style.paddingRight = `${gutter}px`;
      }
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

  useEffect(() => {
    function updateScrollbarGutter() {
      if (headerScrollRef.current && bodyScrollRef.current) {
        const gutter = bodyScrollRef.current.offsetWidth - bodyScrollRef.current.clientWidth;
        headerScrollRef.current.style.paddingRight = `${gutter}px`;
      }
    }
    updateScrollbarGutter();
    window.addEventListener('resize', updateScrollbarGutter);
    return () => window.removeEventListener('resize', updateScrollbarGutter);
  }, [entries.length, columnOrder, columnWidths]);

  function handleDragStart(key: ReorderableColumnKey) {
    draggedKeyRef.current = key;
  }
  function handleDragOver(key: ReorderableColumnKey, e: DragEvent) {
    e.preventDefault();
    if (draggedKeyRef.current && draggedKeyRef.current !== key) setDragOverKey(key);
  }
  function handleDrop(targetKey: ReorderableColumnKey) {
    const draggedKey = draggedKeyRef.current;
    draggedKeyRef.current = null;
    setDragOverKey(null);
    if (!draggedKey || draggedKey === targetKey) return;
    const next = columnOrder.filter((k) => k !== draggedKey);
    next.splice(next.indexOf(targetKey), 0, draggedKey);
    onReorderColumn(next);
  }
  function handleDragEnd() {
    draggedKeyRef.current = null;
    setDragOverKey(null);
  }

  function handleResizeStart(key: ReorderableColumnKey, e: ReactMouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = columnWidths[key] ?? DEFAULT_COL_WIDTHS[key];
    resizeStateRef.current = { key, startX: e.clientX, startWidth };
    function onMove(moveEvent: MouseEvent) {
      const state = resizeStateRef.current;
      if (!state) return;
      const nextWidth = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, state.startWidth + (moveEvent.clientX - state.startX)));
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

  function handleCellKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      suppressBlurRef.current = true;
      onSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      suppressBlurRef.current = true;
      onCancelEdit();
    }
  }

  // Click-outside-to-save: the cell's own Save/Cancel buttons are gone — editing a cell and then
  // clicking anywhere else (another cell, the page background) commits it immediately.
  function handleCellBlur(e: FocusEvent<HTMLDivElement>) {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onSaveEdit();
    }
  }

  const colgroup = (
    <colgroup>
      {canEdit && <col className="col-actions" />}
      <col className={`col-dpr${canEdit ? '' : ' col-dpr-noactions'}`} style={{ width: STICKY_COL_WIDTHS.sno }} />
      {columnOrder.map((key) => (
        <col key={key} style={{ width: columnWidths[key] ?? DEFAULT_COL_WIDTHS[key] }} />
      ))}
    </colgroup>
  );

  // Collapses consecutive same-group columns in the CURRENT columnOrder into spans for the group
  // header row — recomputed from columnOrder (not DEFAULT_COLUMN_ORDER) so a column dragged out
  // of its group's block during Edit Layout just splits that group into two smaller spans instead
  // of showing a wrong/stale label.
  const groupSpans: { group: ColumnGroup; span: number }[] = [];
  for (const key of columnOrder) {
    const group = COLUMNS[key].group;
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.group === group) {
      last.span += 1;
    } else {
      groupSpans.push({ group, span: 1 });
    }
  }

  // Alternating white/grey per group span, reusing the table's own existing header grey
  // (#E2E8F0, same as the individual-column header row below it) instead of inventing a new
  // color — so each group reads as its own block without a palette mismatch. S.No has no group
  // span of its own (it's a separate sticky column spanning both header rows), but the user
  // considers it part of General, so it borrows General's own span color rather than a fixed one
  // — if General ever gets dragged apart into two spans, S.No just follows the first of them.
  const GROUP_BG = ['#ffffff', '#E2E8F0'];
  const generalSpanIndex = groupSpans.findIndex((g) => g.group === 'General');
  const snoBg = GROUP_BG[(generalSpanIndex === -1 ? 0 : generalSpanIndex) % 2];

  function renderHeaderCell(key: ReorderableColumnKey, index: number) {
    const def = COLUMNS[key];
    const isLastInGroup = isLastColumnOfGroup(index, columnOrder);
    const isEditable = canEdit && !!def.renderEditCell;
    const classNames = [
      def.headerClassName,
      layoutEditable ? 'col-layout-editable' : undefined,
      dragOverKey === key ? 'col-drag-over' : undefined,
      isLastInGroup ? 'group-boundary' : undefined,
      isEditable ? 'col-header-editable' : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    const isSortable = !layoutEditable && !!def.sortColumn;
    const hasFilter = !layoutEditable && !!def.filter;
    const filterField = COLUMN_FILTER_FIELD[key];

    // Per-column filter value/onChange — filterField maps this column to its DdTrackerColumnFilters
    // key (they're not always the same name, e.g. this column is `supplyConfirmation`, its filter
    // field is also `supplyConfirmation`, but `prNumber`'s is `requisitionNo`); dynamicOptionsKey
    // does the same for which distinct-value list a 'multi' filter reads from filterOptions.
    let filterNode: ReactNode = null;
    if (hasFilter && def.filter && filterField) {
      if (def.filter.kind === 'multi') {
        const optionsKey = COLUMN_FILTER_OPTIONS_KEY[key];
        const options = optionsKey ? filterOptions[optionsKey].map((v) => ({ value: v, label: v })) : def.filter.options;
        filterNode = (
          <ColumnFilterMenu
            options={options}
            selected={filters[filterField] as string[]}
            onChange={(values) => onFilterChange(filterField, values as DdTrackerColumnFilters[typeof filterField])}
          />
        );
      } else if (def.filter.kind === 'text') {
        filterNode = (
          <ColumnValueFilter
            kind="text"
            value={{ text: filters[filterField] as string }}
            onChange={(v) => onFilterChange(filterField, (v.text ?? '') as DdTrackerColumnFilters[typeof filterField])}
          />
        );
      } else if (def.filter.kind === 'date') {
        filterNode = (
          <ColumnValueFilter
            kind="date"
            value={filters[filterField] as { from: string; to: string }}
            onChange={(v) =>
              onFilterChange(filterField, { from: v.from ?? '', to: v.to ?? '' } as DdTrackerColumnFilters[typeof filterField])
            }
          />
        );
      }
    }

    return (
      <th
        key={key}
        className={[classNames, isSortable ? 'sortable-col' : undefined, hasFilter ? 'col-has-filter' : undefined]
          .filter(Boolean)
          .join(' ') || undefined}
        draggable={layoutEditable}
        onDragStart={layoutEditable ? () => handleDragStart(key) : undefined}
        onDragOver={layoutEditable ? (e) => handleDragOver(key, e) : undefined}
        onDrop={layoutEditable ? () => handleDrop(key) : undefined}
        onDragEnd={layoutEditable ? handleDragEnd : undefined}
        onClick={isSortable ? () => onSort(def.sortColumn!) : undefined}
      >
        <span className="th-label-wrap">
          {def.label}
          {isSortable && (
            <span className="sort-arrow">{sortBy === def.sortColumn ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
          )}
          {isEditable && (
            <span className="col-editable-badge" title="Editable column (double-click cell to edit)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </span>
          )}
          {filterNode && <span onClick={(e) => e.stopPropagation()}>{filterNode}</span>}
        </span>
        {layoutEditable && (
          <span className="col-resize-handle" onMouseDown={(e) => handleResizeStart(key, e)} title="Drag to resize" />
        )}
      </th>
    );
  }

  const totalCols = columnOrder.length + 1 + (canEdit ? 1 : 0);

  return (
    <>
      <div className="table-header-scroll" ref={headerScrollRef}>
        <table className="data-table">
          {colgroup}
          <thead>
            <tr className="dd-tracker-group-row">
              {canEdit && (
                <th className="sticky-col col-actions dd-tracker-sno-header" rowSpan={2}>
                  <input
                    type="checkbox"
                    checked={entries.length > 0 && selectedIds.size === entries.length}
                    onChange={onToggleSelectAll}
                    disabled={entries.length === 0 || isAddingNew || layoutEditable}
                    title="Select all on this page"
                  />
                </th>
              )}
              <th
                className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'} sortable-col dd-tracker-sno-header`}
                rowSpan={2}
                onClick={() => onSort('seqNo')}
              >
                S.No <span className="sort-arrow">{sortBy === 'seqNo' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
              </th>
              {groupSpans.map((g, i) => {
                const isLastGroup = i === groupSpans.length - 1;
                return (
                  <th
                    key={i}
                    colSpan={g.span}
                    className={`dd-tracker-group-header${!isLastGroup ? ' group-boundary' : ''}`}
                  >
                    <span className="dd-tracker-group-title">
                      {renderGroupIcon(g.group)}
                      <span>{g.group}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
            <tr>
              {columnOrder.map((key, idx) => renderHeaderCell(key, idx))}
            </tr>
          </thead>
        </table>
      </div>
      <div className="table-body-scroll" ref={bodyScrollRef} onScroll={syncHeaderScroll}>
        <table className="data-table">
          {colgroup}
          <tbody>
            {isAddingNew && (
              <tr className="row-editing">
                {canEdit && (
                  <td className="sticky-col col-actions">
                    <div className="row-actions">
                      <button className="icon-btn icon-btn-success" title="Save" onClick={onSaveNew} disabled={isSavingNew}>
                        {isSavingNew ? '…' : '✓'}
                      </button>
                      <button className="icon-btn icon-btn-muted" title="Cancel" onClick={onCancelNew}>×</button>
                    </div>
                  </td>
                )}
                <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>—</td>
                {columnOrder.map((key, idx) => {
                  const def = COLUMNS[key];
                  const isLastInGroup = isLastColumnOfGroup(idx, columnOrder);
                  return (
                    <td key={key} className={[def.cellClassName, isLastInGroup ? 'group-boundary' : undefined].filter(Boolean).join(' ') || undefined}>
                      {def.renderEditCell
                        ? def.renderEditCell({ form: newRowForm, onChange: onNewRowChange, onSelectAndSave: onNewRowChange, onClose: () => {} })
                        : '—'}
                    </td>
                  );
                })}
              </tr>
            )}
            {entries.length === 0 && !isAddingNew && (
              <tr>
                <td colSpan={totalCols} className="empty-state">
                  No DD Tracker entries match the current filters.
                </td>
              </tr>
            )}
            {entries.map((entry, rowIndex) => {
              const rowNumber = (page - 1) * pageSize + rowIndex + 1;
              const isEditingRow = editingId === entry.id;
              const editCtx: EditCellCtx | null =
                isEditingRow && editForm ? { form: editForm, onChange: onEditFormChange, onSelectAndSave, onClose: onCancelEdit } : null;
              return (
                <tr key={entry.id} className={entry.invoiceType === 'Proforma Invoice' ? 'dd-tracker-row-proforma' : undefined}>
                  {canEdit && (
                    <td className="sticky-col col-actions">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(entry.id)}
                        onChange={() => onToggleSelect(entry.id)}
                        disabled={isAddingNew || layoutEditable}
                      />
                    </td>
                  )}
                  <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{rowNumber}</td>
                  {columnOrder.map((key, idx) => {
                    const def = COLUMNS[key];
                    const isLastInGroup = isLastColumnOfGroup(idx, columnOrder);
                    const isEditingThisCell = isEditingRow && editingField === key;
                    const isEditable = canEdit && !!def.renderEditCell;
                    if (isEditingThisCell && editCtx) {
                      // Dropdown columns commit on selection — no Save/Cancel, just the control.
                      if (def.immediateCommit) {
                        return (
                          <td key={key} className={[def.cellClassName, isLastInGroup ? 'group-boundary' : undefined].filter(Boolean).join(' ') || undefined}>
                            <div className="dd-tracker-cell-edit dd-tracker-cell-edit-immediate">
                              {def.renderEditCell!(editCtx)}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={key} className={[def.cellClassName, isLastInGroup ? 'group-boundary' : undefined].filter(Boolean).join(' ') || undefined}>
                          <div
                            className={`dd-tracker-cell-edit${isSavingEdit ? ' dd-tracker-cell-saving' : ''}`}
                            onKeyDown={handleCellKeyDown}
                            onBlur={handleCellBlur}
                          >
                            {def.renderEditCell!(editCtx)}
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={key}
                        className={[def.cellClassName, isEditable ? 'dd-tracker-editable-cell' : undefined, isLastInGroup ? 'group-boundary' : undefined].filter(Boolean).join(' ') || undefined}
                        onDoubleClick={isEditable && !layoutEditable ? () => onStartCellEdit(entry, key) : undefined}
                        title={isEditable ? 'Double-click to edit' : undefined}
                      >
                        {def.renderCell(entry)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
