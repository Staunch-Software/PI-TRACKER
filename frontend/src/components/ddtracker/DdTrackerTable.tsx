import { useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from 'react';
import type { DdTrackerEntry } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import type { DdTrackerFormState } from './ddTrackerForm';

// Same split as PiEntriesTable/LandingReportsTable: Actions + S.No are fixed, non-reorderable
// sticky columns. Vessel is NOT a column here — it's filtered via the capsule row above the table
// (see DdTrackerPage), since a vessel is picked before looking at the table at all, not filtered
// from within it.
const STICKY_COL_WIDTHS = {
  actions: 110,
  sno: 80,
} as const;

const INVOICE_TYPE_OPTIONS = ['Tax Invoice', 'Proforma Invoice'];

export const DEFAULT_COL_WIDTHS = {
  entryType: 90,
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
  invoiceType: 140,
  invoiceAmount: 140,
  invoiceCurrency: 110,
  invoiceStatus: 150,
  paymentStatus: 160,
} as const;

export type ReorderableColumnKey = keyof typeof DEFAULT_COL_WIDTHS;

export const DEFAULT_COLUMN_ORDER = [
  'entryType', 'prNumber', 'prStatus', 'poNumber', 'poStatus', 'title', 'vendor', 'poAmount',
  'poCurrency', 'supplyPort', 'orderStatus', 'leadDays', 'readinessDate', 'exStock',
  'supplyConfirmation', 'remarks', 'invoiceNumber', 'invoiceType', 'invoiceAmount',
  'invoiceCurrency', 'invoiceStatus', 'paymentStatus',
] as const satisfies readonly ReorderableColumnKey[];

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 1000;

export type SortColumn = 'seqNo' | 'vesselName';

interface EditCellCtx {
  form: DdTrackerFormState;
  onChange: (field: keyof DdTrackerFormState, value: string) => void;
}

interface ColumnDef {
  label: string;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (entry: DdTrackerEntry) => ReactNode;
  // Omitted for columns sourced live from the SmartPAL scrape (PR/PO status, vendor, amount,
  // supply port) or computed (Lead Days) — those are never editable here.
  renderEditCell?: (ctx: EditCellCtx) => ReactNode;
}

const COLUMNS: Record<ReorderableColumnKey, ColumnDef> = {
  entryType: {
    label: 'Type',
    renderCell: (e) => e.entryType ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <select value={form.entryType} onChange={(ev) => onChange('entryType', ev.target.value)}>
        <option value="">—</option>
        {['DD', 'OPEX', 'NB', 'PD'].map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    ),
  },
  prNumber: {
    label: 'PR Number',
    renderCell: (e) => e.requisitionNo ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.requisitionNo} onChange={(ev) => onChange('requisitionNo', ev.target.value)} />
    ),
  },
  prStatus: {
    label: 'PR Status',
    renderCell: (e) => e.prStatusLive ?? '—',
  },
  poNumber: {
    label: 'PO Number',
    renderCell: (e) => e.poNo ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.poNo} onChange={(ev) => onChange('poNo', ev.target.value)} />
    ),
  },
  poStatus: {
    label: 'PO Status',
    renderCell: (e) => e.poApprovedStatus ?? '—',
  },
  title: {
    label: 'Title',
    renderCell: (e) => e.title ?? e.poTitle ?? e.prTitle ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.title} onChange={(ev) => onChange('title', ev.target.value)} />
    ),
  },
  vendor: {
    label: 'Vendor',
    renderCell: (e) => e.poVendor ?? '—',
  },
  poAmount: {
    label: 'PO Amount',
    headerClassName: 'col-right',
    cellClassName: 'col-right',
    renderCell: (e) => formatAmount(e.poBaseAmount),
  },
  poCurrency: {
    label: 'PO Currency',
    renderCell: (e) => e.poBaseCurrency ?? '—',
  },
  supplyPort: {
    label: 'Supply Port',
    renderCell: (e) => e.poSchdDelPort ?? '—',
  },
  orderStatus: {
    label: 'Order Status',
    renderCell: (e) => e.orderStatus ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.orderStatus} onChange={(ev) => onChange('orderStatus', ev.target.value)} />
    ),
  },
  leadDays: {
    label: 'Lead Days',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    // Computed server-side as (readinessDate - poConfirmedDate) — never editable, see
    // backend/app/api/routes/dd_tracker.py.
    renderCell: (e) => e.leadDays ?? '—',
  },
  readinessDate: {
    label: 'Readiness Date',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (e) => formatDate(e.readinessDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.readinessDate} onChange={(ev) => onChange('readinessDate', ev.target.value)} />
    ),
  },
  exStock: {
    label: 'Ex-Stock',
    renderCell: (e) => e.exStock ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.exStock} onChange={(ev) => onChange('exStock', ev.target.value)} />
    ),
  },
  supplyConfirmation: {
    label: 'Supply Confirmation',
    renderCell: (e) => e.supplyConfirmation ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.supplyConfirmation} onChange={(ev) => onChange('supplyConfirmation', ev.target.value)} />
    ),
  },
  remarks: {
    label: 'Remarks',
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
    renderCell: (e) => e.invoiceNumber ?? '—',
  },
  invoiceType: {
    label: 'Invoice Type',
    renderCell: (e) => e.invoiceType ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <select value={form.invoiceType} onChange={(ev) => onChange('invoiceType', ev.target.value)}>
        <option value="">—</option>
        {INVOICE_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
    ),
  },
  invoiceAmount: {
    label: 'Invoice Amount',
    headerClassName: 'col-right',
    cellClassName: 'col-right',
    renderCell: (e) => formatAmount(e.invoiceAmount),
  },
  invoiceCurrency: {
    label: 'Invoice Currency',
    renderCell: (e) => e.invoiceCurrency ?? '—',
  },
  invoiceStatus: {
    label: 'Invoice Status',
    renderCell: (e) => e.invoiceStatus ?? '—',
  },
  paymentStatus: {
    label: 'Payment Status',
    renderCell: (e) => e.paymentStatus ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.paymentStatus} onChange={(ev) => onChange('paymentStatus', ev.target.value)} />
    ),
  },
};

interface Props {
  entries: DdTrackerEntry[];
  canEdit: boolean;
  sortBy: SortColumn | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;

  editingId: string | null;
  editForm: DdTrackerFormState | null;
  isSavingEdit: boolean;
  onStartEdit: (entry: DdTrackerEntry) => void;
  onEditFormChange: (field: keyof DdTrackerFormState, value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;

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
  canEdit,
  sortBy,
  sortDir,
  onSort,
  editingId,
  editForm,
  isSavingEdit,
  onStartEdit,
  onEditFormChange,
  onSaveEdit,
  onCancelEdit,
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

  // Double-click anywhere in a row starts editing it — no separate Edit button (see
  // DdTrackerPage's "easier to use" instruction). Ignored while another row is already being
  // edited/added, or while reordering/resizing columns, same guard the old Edit button had.
  function handleRowDoubleClick(entry: DdTrackerEntry) {
    if (!canEdit || editingId !== null || isAddingNew || layoutEditable) return;
    onStartEdit(entry);
  }

  const colgroup = (
    <colgroup>
      {canEdit && <col className="col-actions" style={{ width: STICKY_COL_WIDTHS.actions }} />}
      <col className={`col-dpr${canEdit ? '' : ' col-dpr-noactions'}`} style={{ width: STICKY_COL_WIDTHS.sno }} />
      {columnOrder.map((key) => (
        <col key={key} style={{ width: columnWidths[key] ?? DEFAULT_COL_WIDTHS[key] }} />
      ))}
    </colgroup>
  );

  function renderHeaderCell(key: ReorderableColumnKey) {
    const def = COLUMNS[key];
    const classNames = [
      def.headerClassName,
      layoutEditable ? 'col-layout-editable' : undefined,
      dragOverKey === key ? 'col-drag-over' : undefined,
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
        {def.label}
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
            <tr>
              {canEdit && <th className="sticky-col col-actions">Actions</th>}
              <th
                className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'} sortable-col`}
                onClick={() => onSort('seqNo')}
              >
                S.No <span className="sort-arrow">{sortBy === 'seqNo' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
              </th>
              {columnOrder.map((key) => renderHeaderCell(key))}
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
                <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>New</td>
                {columnOrder.map((key) => {
                  const def = COLUMNS[key];
                  return (
                    <td key={key} className={def.cellClassName}>
                      {def.renderEditCell ? def.renderEditCell({ form: newRowForm, onChange: onNewRowChange }) : '—'}
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
            {entries.map((entry) => {
              const isEditing = editingId === entry.id;
              const editCtx: EditCellCtx | null = isEditing && editForm ? { form: editForm, onChange: onEditFormChange } : null;
              return (
                <tr
                  key={entry.id}
                  className={isEditing ? 'row-editing' : undefined}
                  onDoubleClick={() => handleRowDoubleClick(entry)}
                >
                  {canEdit && (
                    <td className="sticky-col col-actions">
                      {isEditing && (
                        <div className="row-actions">
                          <button className="icon-btn icon-btn-success" title="Save" onClick={onSaveEdit} disabled={isSavingEdit}>
                            {isSavingEdit ? '…' : '✓'}
                          </button>
                          <button className="icon-btn icon-btn-muted" title="Cancel" onClick={onCancelEdit}>×</button>
                        </div>
                      )}
                    </td>
                  )}
                  <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{entry.seqNo}</td>
                  {columnOrder.map((key) => {
                    const def = COLUMNS[key];
                    return (
                      <td key={key} className={def.cellClassName}>
                        {editCtx && def.renderEditCell ? def.renderEditCell(editCtx) : def.renderCell(entry)}
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
