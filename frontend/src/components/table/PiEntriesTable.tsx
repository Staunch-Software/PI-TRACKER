import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type UIEvent,
} from 'react';
import {
  Currency,
  FOLLOW_UP_STATUS_LABELS,
  FollowUpStatus,
  type PiEntry,
  type Vendor,
  type Vessel,
} from '../../shared';
import type { PiEntryFormState } from '../../lib/piEntryForm';
import { formatAmount, formatDate, formatDateTime } from '../../lib/format';
import { LookupSelect } from '../modals/LookupSelect';
import { SearchableSelect } from '../common/SearchableSelect';
import { ColumnFilterMenu, type ColumnFilterOption } from './ColumnFilterMenu';
import { AttachmentCell } from './AttachmentCell';
import { ExpandableCell } from './ExpandableCell';
import { StatusBadge } from './StatusBadge';

// Fixed pixel widths for the sticky columns (Actions / DPR No.) — these are never reorderable
// or resizable (see ReorderableColumnKey below), so they stay out of the column-width map that
// Edit Layout mutates.
const STICKY_COL_WIDTHS = {
  actions: 80,
  dpr: 140,
} as const;

// Every reorderable column's default width, static and hardcoded — used as the fallback for any
// column missing from a saved layout (new column added later, or nothing saved yet). Deliberately
// NOT measured off the DOM at runtime: two independently-laid-out tables (header/body, see the
// .table-header-scroll comment in global.css) given "the same" measured widths could still round
// fractional pixels differently, and that drift compounds left-to-right. A static width has
// nothing left to measure, so nothing can diverge between the two tables.
export const DEFAULT_COL_WIDTHS = {
  attachment: 90,
  invoiceNo: 130,
  dprDate: 110,
  vessel: 170,
  vendor: 220,
  serviceDetails: 460,
  amountInr: 130,
  fcAmount: 110,
  currency: 100,
  paymentDate: 120,
  paymentReference: 340,
  daysSincePayment: 150,
  // Wide enough for the longest label ("Pending - Discrepancy to Resolve") on one line without
  // the badge getting silently hard-clipped — see .col-status in global.css for the overflow
  // fallback that also guards against this if a future label ends up even longer.
  followupStatus: 260,
  // Sized for realistic remarks (2-line clamp via ExpandableCell) — the longest seen so far,
  // "Final Invoice will be sent after Installation at Vizag- 22nd July 2026" (~72 chars), fits
  // comfortably in 2 lines at this width. Was 600, which left a lot of dead space since most
  // remarks are one short sentence.
  lastKnownRemark: 300,
  reminder1: 140,
  reminder2: 140,
  finalInvoiceReceived: 160,
  invoiceDate: 120,
  attachedBy: 120,
  dateAttached: 170,
  notes: 340,
} as const;

export type ReorderableColumnKey = keyof typeof DEFAULT_COL_WIDTHS;

// Default order of the reorderable columns (everything except the sticky Actions/DPR No./
// Follow-up Status columns, which always stay pinned at the left — followupStatus is rendered
// as a fixed 3rd sticky column below, so it's deliberately absent here even though it still has
// a DEFAULT_COL_WIDTHS entry (its width stays user-resizable).
export const DEFAULT_COLUMN_ORDER = [
  'attachment', 'invoiceNo', 'dprDate', 'vessel', 'vendor', 'serviceDetails',
  'amountInr', 'fcAmount', 'currency', 'paymentDate', 'paymentReference', 'daysSincePayment',
  'lastKnownRemark', 'reminder1', 'reminder2', 'finalInvoiceReceived',
  'invoiceDate', 'attachedBy', 'dateAttached', 'notes',
] as const satisfies readonly ReorderableColumnKey[];

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 1000;

export type SortColumn =
  | 'dprNo'
  | 'dprDate'
  | 'vesselName'
  | 'vendorName'
  | 'amountInr'
  | 'paymentDate'
  | 'daysSincePayment'
  | 'followupStatus';

interface EditCellCtx {
  form: PiEntryFormState;
  onChange: <K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) => void;
  vessels: Vessel[];
  vendors: Vendor[];
  entry: PiEntry | null; // null while adding a new row — can't attach files before the PI exists
  canEdit: boolean;
}

interface ColumnDef {
  label: string;
  sortColumn?: SortColumn;
  headerClassName?: string;
  cellClassName?: string;
  // Only set on columns with a small, fixed set of values worth filtering directly from the
  // header (e.g. Currency) — renders a hover-revealed funnel icon that opens a checkbox dropdown,
  // separate from the toolbar's own filters.
  filter?: { options: ColumnFilterOption[] };
  renderCell: (entry: PiEntry, canEdit: boolean) => ReactNode;
  renderEditCell: (ctx: EditCellCtx) => ReactNode;
}

// One entry per reorderable column: how to render its header, its read-only cell, and its
// editable-row cell. Rendering the header/body from this map (driven by a column-order array)
// instead of hand-written JSX per column is what makes drag-to-reorder possible.
const COLUMNS: Record<ReorderableColumnKey, ColumnDef> = {
  attachment: {
    label: 'Attachment',
    renderCell: (entry, canEdit) => (
      <AttachmentCell piEntryId={entry.id} dprNo={entry.dprNo} attachmentCount={entry.attachmentCount} canEdit={canEdit} />
    ),
    renderEditCell: ({ entry, canEdit }) =>
      entry ? (
        <AttachmentCell piEntryId={entry.id} dprNo={entry.dprNo} attachmentCount={entry.attachmentCount} canEdit={canEdit} />
      ) : (
        '—'
      ),
  },
  invoiceNo: {
    label: 'Invoice No.',
    renderCell: (entry) => entry.invoiceNo ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.invoiceNo} onChange={(e) => onChange('invoiceNo', e.target.value)} style={{ width: 120 }} />
    ),
  },
  dprDate: {
    label: 'DPR Date',
    sortColumn: 'dprDate',
    renderCell: (entry) => formatDate(entry.dprDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.dprDate} onChange={(e) => onChange('dprDate', e.target.value)} />
    ),
  },
  vessel: {
    label: 'Vessel',
    renderCell: (entry) => entry.vesselName,
    renderEditCell: ({ form, onChange, vessels }) => (
      <LookupSelect compact label="Vessel" items={vessels} value={form.vesselId} onChange={(id) => onChange('vesselId', id)} createPath="/vessels" queryKey="vessels" />
    ),
  },
  vendor: {
    label: 'Vendor',
    headerClassName: 'col-vendor',
    cellClassName: 'col-vendor',
    renderCell: (entry) => <ExpandableCell text={entry.vendorName} />,
    renderEditCell: ({ form, onChange, vendors }) => (
      <LookupSelect compact label="Vendor" items={vendors} value={form.vendorId} onChange={(id) => onChange('vendorId', id)} createPath="/vendors" queryKey="vendors" />
    ),
  },
  serviceDetails: {
    label: 'Service Details',
    headerClassName: 'col-fixed-wide',
    cellClassName: 'col-fixed-wide',
    renderCell: (entry) => <ExpandableCell text={entry.serviceDetails} />,
    renderEditCell: ({ form, onChange }) => (
      <input value={form.serviceDetails} onChange={(e) => onChange('serviceDetails', e.target.value)} />
    ),
  },
  amountInr: {
    label: 'Amount (INR)',
    sortColumn: 'amountInr',
    renderCell: (entry) => formatAmount(entry.amountInr),
    renderEditCell: ({ form, onChange }) => (
      <input type="number" step="0.01" value={form.amountInr} onChange={(e) => onChange('amountInr', e.target.value)} style={{ width: 110 }} />
    ),
  },
  fcAmount: {
    label: 'FC Amount',
    renderCell: (entry) => formatAmount(entry.fcAmount),
    renderEditCell: ({ form, onChange }) => (
      <input type="number" step="0.01" value={form.fcAmount} onChange={(e) => onChange('fcAmount', e.target.value)} style={{ width: 100 }} />
    ),
  },
  currency: {
    label: 'Currency',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    filter: { options: Object.values(Currency).map((c) => ({ value: c, label: c })) },
    renderCell: (entry) => entry.currency,
    renderEditCell: ({ form, onChange }) => (
      <SearchableSelect options={Object.values(Currency).map((c) => ({ value: c, label: c }))} value={form.currency} onChange={(v) => onChange('currency', v as Currency)} />
    ),
  },
  paymentDate: {
    label: 'Payment Date',
    sortColumn: 'paymentDate',
    renderCell: (entry) => formatDate(entry.paymentDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.paymentDate} onChange={(e) => onChange('paymentDate', e.target.value)} />
    ),
  },
  paymentReference: {
    label: 'Payment Reference',
    headerClassName: 'col-fixed',
    cellClassName: 'col-fixed',
    renderCell: (entry) => <ExpandableCell text={entry.paymentReference} />,
    renderEditCell: ({ form, onChange }) => (
      <input value={form.paymentReference} onChange={(e) => onChange('paymentReference', e.target.value)} />
    ),
  },
  daysSincePayment: {
    label: 'Days Since Payment',
    sortColumn: 'daysSincePayment',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => entry.daysSincePayment ?? '—',
    renderEditCell: () => '—',
  },
  followupStatus: {
    // Rendered as a fixed 3rd sticky column (see the hardcoded <th>/<td> in the JSX below),
    // not through the generic columnOrder loop — sortColumn/renderCell/renderEditCell are still
    // read directly from this entry, but label/headerClassName/cellClassName aren't (the sticky
    // header and cells are hand-written to control their fixed position and width alongside
    // Actions/DPR No.).
    label: 'Follow-up Status',
    sortColumn: 'followupStatus',
    renderCell: (entry) => <StatusBadge status={entry.followupStatus} />,
    renderEditCell: ({ form, onChange }) => (
      <SearchableSelect options={Object.values(FollowUpStatus).map((s) => ({ value: s, label: FOLLOW_UP_STATUS_LABELS[s] }))} value={form.followupStatus} onChange={(v) => onChange('followupStatus', v as FollowUpStatus)} />
    ),
  },
  lastKnownRemark: {
    label: 'Last Known Remark',
    headerClassName: 'col-fixed-xwide',
    cellClassName: 'col-fixed-xwide',
    renderCell: (entry) => <ExpandableCell text={entry.lastKnownRemark} />,
    renderEditCell: ({ form, onChange }) => (
      <input value={form.lastKnownRemark} onChange={(e) => onChange('lastKnownRemark', e.target.value)} />
    ),
  },
  reminder1: {
    label: 'Reminder 1 Sent',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => formatDate(entry.reminder1SentDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.reminder1SentDate} onChange={(e) => onChange('reminder1SentDate', e.target.value)} />
    ),
  },
  reminder2: {
    label: 'Reminder 2 Sent',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => formatDate(entry.reminder2SentDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.reminder2SentDate} onChange={(e) => onChange('reminder2SentDate', e.target.value)} />
    ),
  },
  finalInvoiceReceived: {
    label: 'Final Invoice Received',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => (entry.finalInvoiceReceived ? 'Yes' : 'No'),
    renderEditCell: ({ form, onChange }) => (
      <input type="checkbox" checked={form.finalInvoiceReceived} onChange={(e) => onChange('finalInvoiceReceived', e.target.checked)} style={{ width: 16, height: 16 }} />
    ),
  },
  invoiceDate: {
    label: 'Invoice Date',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => formatDate(entry.invoiceDate),
    renderEditCell: ({ form, onChange }) => (
      <input type="date" value={form.invoiceDate} onChange={(e) => onChange('invoiceDate', e.target.value)} />
    ),
  },
  attachedBy: {
    label: 'Attached By',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => entry.attachedByName ?? '—',
    renderEditCell: () => '—',
  },
  dateAttached: {
    label: 'Date Attached',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (entry) => formatDateTime(entry.dateAttached),
    renderEditCell: () => '—',
  },
  notes: {
    label: 'Notes',
    headerClassName: 'col-fixed',
    cellClassName: 'col-fixed',
    renderCell: (entry) => <ExpandableCell text={entry.notes} />,
    renderEditCell: ({ form, onChange }) => <input value={form.notes} onChange={(e) => onChange('notes', e.target.value)} />,
  },
};

interface Props {
  entries: PiEntry[];
  canEdit: boolean;
  vessels: Vessel[];
  vendors: Vendor[];
  sortBy: SortColumn | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  editingId: string | null;
  editForm: PiEntryFormState | null;
  highlightId: string | null;
  onStartEdit: (entry: PiEntry) => void;
  onEditFormChange: <K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSavingEdit: boolean;
  isAddingNew: boolean;
  newRowForm: PiEntryFormState;
  onNewRowChange: <K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) => void;
  onSaveNew: () => void;
  onCancelNew: () => void;
  isSavingNew: boolean;
  saveError: string | null;
  columnOrder: ReorderableColumnKey[];
  columnWidths: Record<string, number>;
  layoutEditable: boolean;
  onReorderColumn: (newOrder: ReorderableColumnKey[]) => void;
  onResizeColumn: (key: ReorderableColumnKey, width: number) => void;
  columnFilters: Record<string, string[]>;
  onColumnFilterChange: (key: string, values: string[]) => void;
}

export function PiEntriesTable({
  entries,
  canEdit,
  vessels,
  vendors,
  sortBy,
  sortDir,
  onSort,
  editingId,
  editForm,
  highlightId,
  onStartEdit,
  onEditFormChange,
  onSaveEdit,
  onCancelEdit,
  isSavingEdit,
  isAddingNew,
  newRowForm,
  onNewRowChange,
  onSaveNew,
  onCancelNew,
  isSavingNew,
  saveError,
  columnOrder,
  columnWidths,
  layoutEditable,
  onReorderColumn,
  onResizeColumn,
  columnFilters,
  onColumnFilterChange,
}: Props) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const draggedKeyRef = useRef<ReorderableColumnKey | null>(null);
  const resizeStateRef = useRef<{ key: ReorderableColumnKey; startX: number; startWidth: number } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<ReorderableColumnKey | null>(null);

  function syncHeaderScroll(e: UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

  // Starting a new row always begins at its first field (DPR No.), so the table should be
  // scrolled back to the leftmost column too — otherwise a user who'd scrolled right to check
  // older columns would land on the new row still scrolled away from where they need to type.
  useEffect(() => {
    if (isAddingNew) {
      bodyScrollRef.current?.scrollTo({ left: 0 });
    }
  }, [isAddingNew]);

  // As focus moves between fields in the row being edited/added (via Tab or a click), bring the
  // focused field into view horizontally — without this, a field past the visible width stays
  // off-screen until the user manually scrolls the table right to find it.
  function handleEditingFocus(e: FocusEvent<HTMLDivElement>) {
    if (e.target.closest('tr.row-editing')) {
      e.target.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }

  function handleDragStart(key: ReorderableColumnKey) {
    draggedKeyRef.current = key;
  }

  function handleDragOver(key: ReorderableColumnKey, e: DragEvent) {
    e.preventDefault();
    if (draggedKeyRef.current && draggedKeyRef.current !== key) {
      setDragOverKey(key);
    }
  }

  function handleDrop(targetKey: ReorderableColumnKey) {
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

  const widths: Record<string, number> = { ...STICKY_COL_WIDTHS };
  widths.status = columnWidths.followupStatus ?? DEFAULT_COL_WIDTHS.followupStatus;
  for (const key of columnOrder) {
    widths[key] = columnWidths[key] ?? DEFAULT_COL_WIDTHS[key];
  }

  const colgroup = (
    <colgroup>
      {canEdit && <col style={{ width: widths.actions }} />}
      <col style={{ width: widths.dpr }} />
      <col style={{ width: widths.status }} />
      {columnOrder.map((col) => (
        <col key={col} style={{ width: widths[col] }} />
      ))}
    </colgroup>
  );

  function renderHeaderCell(key: ReorderableColumnKey) {
    const def = COLUMNS[key];
    const classNames = [
      def.headerClassName,
      def.sortColumn ? 'sortable-col' : undefined,
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
        onClick={!layoutEditable && def.sortColumn ? () => onSort(def.sortColumn!) : undefined}
      >
        {def.label}
        {def.sortColumn && !layoutEditable && (
          <span className="sort-arrow">{sortBy === def.sortColumn ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
        )}
        {def.filter && !layoutEditable && (
          <span onClick={(e) => e.stopPropagation()}>
            <ColumnFilterMenu
              options={def.filter.options}
              selected={columnFilters[key] ?? []}
              onChange={(values) => onColumnFilterChange(key, values)}
            />
          </span>
        )}
        {layoutEditable && (
          <span className="col-resize-handle" onMouseDown={(e) => handleResizeStart(key, e)} title="Drag to resize" />
        )}
      </th>
    );
  }

  return (
    <div className="card">
      <div className="table-header-scroll" ref={headerScrollRef}>
        <table className="data-table">
          {colgroup}
          <thead>
            <tr>
              {canEdit && <th className="sticky-col col-actions">Actions</th>}
              <th
                className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'} sortable-col`}
                onClick={() => onSort('dprNo')}
              >
                DPR No. <span className="sort-arrow">{sortBy === 'dprNo' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
              </th>
              <th
                className={`sticky-col col-status${canEdit ? '' : ' col-status-noactions'} sortable-col`}
                onClick={() => onSort('followupStatus')}
              >
                Follow-up Status{' '}
                <span className="sort-arrow">{sortBy === 'followupStatus' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                {layoutEditable && (
                  <span
                    className="col-resize-handle"
                    onMouseDown={(e) => handleResizeStart('followupStatus', e)}
                    title="Drag to resize"
                  />
                )}
              </th>
              {columnOrder.map((key) => renderHeaderCell(key))}
            </tr>
          </thead>
        </table>
      </div>
      <div className="table-body-scroll" ref={bodyScrollRef} onScroll={syncHeaderScroll} onFocus={handleEditingFocus}>
        <table className="data-table">
          {colgroup}
        <tbody>
          {entries.length === 0 && !isAddingNew && (
            <tr>
              <td colSpan={columnOrder.length + 1 + (canEdit ? 2 : 1)} className="empty-state">
                No PI entries match the current filters.
              </td>
            </tr>
          )}

          {entries.map((entry) => {
            const isEditing = editingId === entry.id;
            const isHighlighted = highlightId === entry.id;
            const editCtx: EditCellCtx | null =
              isEditing && editForm
                ? { form: editForm, onChange: onEditFormChange, vessels, vendors, entry, canEdit }
                : null;
            return (
              <tr
                key={entry.id}
                className={isEditing ? 'row-editing' : isHighlighted ? 'row-flash' : undefined}
              >
                {canEdit && (
                  <td className="sticky-col col-actions">
                    {isEditing ? (
                      <div className="row-actions">
                        <button className="icon-btn" title="Save" onClick={onSaveEdit} disabled={isSavingEdit}>
                          {isSavingEdit ? '…' : '✓'}
                        </button>
                        <button className="icon-btn" title="Cancel" onClick={onCancelEdit}>
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        className="icon-btn"
                        title="Edit"
                        onClick={() => onStartEdit(entry)}
                        disabled={editingId !== null || isAddingNew || layoutEditable}
                      >
                        ✎
                      </button>
                    )}
                  </td>
                )}

                {editCtx ? (
                  <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>
                    <input value={editCtx.form.dprNo} onChange={(e) => onEditFormChange('dprNo', e.target.value)} style={{ width: 110 }} />
                  </td>
                ) : (
                  <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{entry.dprNo}</td>
                )}

                <td className={`sticky-col col-status${canEdit ? '' : ' col-status-noactions'}`}>
                  {editCtx ? COLUMNS.followupStatus.renderEditCell(editCtx) : COLUMNS.followupStatus.renderCell(entry, canEdit)}
                </td>

                {columnOrder.map((key) => {
                  const def = COLUMNS[key];
                  return (
                    <td key={key} className={def.cellClassName}>
                      {editCtx ? def.renderEditCell(editCtx) : def.renderCell(entry, canEdit)}
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {canEdit && isAddingNew && (
            <tr className="row-editing">
              <td className="sticky-col col-actions">
                <div className="row-actions">
                  <button className="icon-btn" title="Save" onClick={onSaveNew} disabled={isSavingNew}>
                    {isSavingNew ? '…' : '✓'}
                  </button>
                  <button className="icon-btn" title="Cancel" onClick={onCancelNew}>
                    ×
                  </button>
                </div>
              </td>
              <td className="sticky-col col-dpr">
                <input value={newRowForm.dprNo} onChange={(e) => onNewRowChange('dprNo', e.target.value)} style={{ width: 110 }} />
              </td>
              <td className="sticky-col col-status">
                {COLUMNS.followupStatus.renderEditCell({
                  form: newRowForm,
                  onChange: onNewRowChange,
                  vessels,
                  vendors,
                  entry: null,
                  canEdit,
                })}
              </td>
              {columnOrder.map((key) => {
                const def = COLUMNS[key];
                const editCtx: EditCellCtx = { form: newRowForm, onChange: onNewRowChange, vessels, vendors, entry: null, canEdit };
                return (
                  <td key={key} className={def.cellClassName}>
                    {def.renderEditCell(editCtx)}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
        </table>
      </div>
      {saveError && (
        <div className="empty-state" style={{ color: 'var(--color-danger)', textAlign: 'left', padding: '10px 16px' }}>
          {saveError}
        </div>
      )}
    </div>
  );
}
