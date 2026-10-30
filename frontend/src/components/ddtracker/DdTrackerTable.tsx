import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from 'react';
import type { DdTrackerEntry } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import { SearchableSelect } from '../common/SearchableSelect';
import type { DdTrackerFormState } from './ddTrackerForm';

// Same sticky-column split as PiEntriesTable/LandingReportsTable, minus an Actions column — there
// is no row-level edit button here; double-clicking an editable cell edits just that cell, with
// its own inline Save/Cancel (see DdTrackerPage). Vessel is also not a column — it's filtered via
// the capsule row above the table instead.
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

export type SortColumn = 'seqNo' | 'vesselName';

interface EditCellCtx {
  form: DdTrackerFormState;
  onChange: (field: keyof DdTrackerFormState, value: string) => void;
  // Only meaningful for immediateCommit columns (see ColumnDef) — picking a dropdown value saves
  // it right away instead of waiting for a separate Save click, since choosing from a short fixed
  // list is already the complete action (unlike a text field, where you might still be typing).
  onSelectAndSave: (field: keyof DdTrackerFormState, value: string) => void;
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
}

const COLUMNS: Record<ReorderableColumnKey, ColumnDef> = {
  entryType: {
    label: 'Type',
    group: 'General',
    renderCell: (e) => e.entryType ?? '—',
    immediateCommit: true,
    renderEditCell: ({ form, onSelectAndSave }) => (
      <SearchableSelect options={ENTRY_TYPE_OPTIONS} value={form.entryType} onChange={(v) => onSelectAndSave('entryType', v)} />
    ),
  },
  prNumber: {
    label: 'PR Number',
    group: 'Requisition',
    renderCell: (e) => e.requisitionNo ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.requisitionNo} onChange={(ev) => onChange('requisitionNo', ev.target.value)} />
    ),
  },
  prStatus: {
    label: 'PR Status',
    group: 'Requisition',
    renderCell: (e) => e.prStatusLive ?? '—',
  },
  poNumber: {
    label: 'PO Number',
    group: 'Purchase Order',
    renderCell: (e) => e.poNo ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.poNo} onChange={(ev) => onChange('poNo', ev.target.value)} />
    ),
  },
  poStatus: {
    label: 'PO Status',
    group: 'Purchase Order',
    renderCell: (e) => e.poApprovedStatus ?? '—',
  },
  title: {
    label: 'Title',
    group: 'General',
    renderCell: (e) => e.title ?? e.poTitle ?? e.prTitle ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.title} onChange={(ev) => onChange('title', ev.target.value)} />
    ),
  },
  vendor: {
    label: 'Vendor',
    group: 'Purchase Order',
    renderCell: (e) => e.poVendor ?? '—',
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
  },
  orderStatus: {
    label: 'Order Status',
    group: 'Tracking',
    renderCell: (e) => e.orderStatus ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.orderStatus} onChange={(ev) => onChange('orderStatus', ev.target.value)} />
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
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.readinessDate} onChange={(ev) => onChange('readinessDate', ev.target.value)} />
    ),
  },
  exStock: {
    label: 'Ex-Stock',
    group: 'Tracking',
    renderCell: (e) => e.exStock ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.exStock} onChange={(ev) => onChange('exStock', ev.target.value)} />
    ),
  },
  supplyConfirmation: {
    label: 'Delivery Status',
    group: 'Tracking',
    renderCell: (e) => e.supplyConfirmation ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.supplyConfirmation} onChange={(ev) => onChange('supplyConfirmation', ev.target.value)} />
    ),
  },
  remarks: {
    label: 'Remarks',
    group: 'Tracking',
    renderCell: (e) => e.remarks ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.remarks} onChange={(ev) => onChange('remarks', ev.target.value)} />
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
    renderEditCell: ({ form, onSelectAndSave }) => (
      <SearchableSelect options={INVOICE_TYPE_OPTIONS} value={form.invoiceType} onChange={(v) => onSelectAndSave('invoiceType', v)} />
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
  },
  // Live-joined from smartpal_invoice_entries.paid_status (see backend/app/api/routes/dd_tracker.py)
  // — never editable here, same stance as Invoice Number/Amount/Currency/Status.
  paymentStatus: {
    label: 'Payment Status',
    group: 'Invoice',
    renderCell: (e) => e.paymentStatus ?? '—',
  },
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
  columnOrder,
  columnWidths,
  layoutEditable,
  onReorderColumn,
  onResizeColumn,
}: Props) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const draggedKeyRef = useRef<ReorderableColumnKey | null>(null);
  const resizeStateRef = useRef<{ key: ReorderableColumnKey; startX: number; startWidth: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<ReorderableColumnKey | null>(null);

  function syncHeaderScroll(e: UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

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
      onSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelEdit();
    }
  }

  const colgroup = (
    <colgroup>
      <col className="col-dpr col-dpr-noactions" style={{ width: STICKY_COL_WIDTHS.sno }} />
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
    return (
      <th
        key={key}
        className={classNames || undefined}
        draggable={layoutEditable}
        onDragStart={layoutEditable ? () => handleDragStart(key) : undefined}
        onDragOver={layoutEditable ? (e) => handleDragOver(key, e) : undefined}
        onDrop={layoutEditable ? () => handleDrop(key) : undefined}
        onDragEnd={layoutEditable ? handleDragEnd : undefined}
      >
        <span className="th-label-wrap">
          {def.label}
          {isEditable && (
            <span className="col-editable-badge" title="Editable column (double-click cell to edit)">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </span>
          )}
        </span>
        {layoutEditable && (
          <span className="col-resize-handle" onMouseDown={(e) => handleResizeStart(key, e)} title="Drag to resize" />
        )}
      </th>
    );
  }

  const totalCols = columnOrder.length + 1;

  return (
    <>
      <div className="table-header-scroll" ref={headerScrollRef}>
        <table className="data-table">
          {colgroup}
          <thead>
            <tr className="dd-tracker-group-row">
              <th
                className="sticky-col col-dpr col-dpr-noactions sortable-col dd-tracker-sno-header"
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
      <div className="table-body-scroll" onScroll={syncHeaderScroll}>
        <table className="data-table">
          {colgroup}
          <tbody>
            {isAddingNew && (
              <tr className="row-editing">
                <td className="sticky-col col-dpr col-dpr-noactions">
                  <div className="row-actions">
                    <button className="icon-btn icon-btn-success" title="Save" onClick={onSaveNew} disabled={isSavingNew}>
                      {isSavingNew ? '…' : '✓'}
                    </button>
                    <button className="icon-btn icon-btn-muted" title="Cancel" onClick={onCancelNew}>×</button>
                  </div>
                </td>
                {columnOrder.map((key, idx) => {
                  const def = COLUMNS[key];
                  const isLastInGroup = isLastColumnOfGroup(idx, columnOrder);
                  return (
                    <td key={key} className={[def.cellClassName, isLastInGroup ? 'group-boundary' : undefined].filter(Boolean).join(' ') || undefined}>
                      {def.renderEditCell
                        ? def.renderEditCell({ form: newRowForm, onChange: onNewRowChange, onSelectAndSave: onNewRowChange })
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
                isEditingRow && editForm ? { form: editForm, onChange: onEditFormChange, onSelectAndSave } : null;
              return (
                <tr key={entry.id}>
                  <td className="sticky-col col-dpr col-dpr-noactions">{rowNumber}</td>
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
                          <div className="dd-tracker-cell-edit" onKeyDown={handleCellKeyDown}>
                            {def.renderEditCell!(editCtx)}
                            <button className="icon-btn icon-btn-success" title="Save" onClick={onSaveEdit} disabled={isSavingEdit}>
                              {isSavingEdit ? '…' : '✓'}
                            </button>
                            <button className="icon-btn icon-btn-muted" title="Cancel" onClick={onCancelEdit}>×</button>
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
