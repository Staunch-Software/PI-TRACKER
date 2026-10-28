import { useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from 'react';
import type { DdTrackerEntry } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import { EditIcon } from '../common/EditIcon';
import { ColumnFilterMenu, type ColumnFilterOption } from '../table/ColumnFilterMenu';
import type { DdTrackerFormState } from './ddTrackerForm';

// Same split as PiEntriesTable/LandingReportsTable: Actions + S.No are fixed, non-reorderable
// sticky columns; Vessel is a 3rd pinned sticky column (with its own column-header filter, see
// DdTrackerPage's vessel filter requirement) but stays user-resizable.
const STICKY_COL_WIDTHS = {
  actions: 110,
  sno: 80,
} as const;

export const DEFAULT_COL_WIDTHS = {
  entryType: 90,
  prNumber: 170,
  prStatus: 180,
  poNumber: 170,
  poStatus: 150,
  title: 320,
  vendor: 220,
  poAmount: 150,
  supplyPort: 160,
  poAcknowledged: 150,
  prNotes: 220,
  orderStatus: 220,
  leadDays: 110,
  readinessDate: 150,
  exStock: 130,
  supplyConfirmation: 180,
  remarks1: 220,
  remarks2: 220,
  invoiceNumber: 160,
  invoiceType: 140,
  invoiceAmount: 140,
  invoiceCurrency: 120,
  paymentStatus: 160,
} as const;

export type ReorderableColumnKey = keyof typeof DEFAULT_COL_WIDTHS;

export const DEFAULT_COLUMN_ORDER = [
  'entryType', 'prNumber', 'prStatus', 'poNumber', 'poStatus', 'title', 'vendor', 'poAmount',
  'supplyPort', 'poAcknowledged', 'prNotes', 'orderStatus', 'leadDays', 'readinessDate', 'exStock',
  'supplyConfirmation', 'remarks1', 'remarks2', 'invoiceNumber', 'invoiceType', 'invoiceAmount',
  'invoiceCurrency', 'paymentStatus',
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
  // supply port, acknowledged date) — those are never editable here, only via the next scrape.
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
    renderCell: (e) => (e.poBaseAmount === null ? '—' : `${e.poBaseCurrency ?? ''} ${formatAmount(e.poBaseAmount)}`.trim()),
  },
  supplyPort: {
    label: 'Supply Port',
    renderCell: (e) => e.poSchdDelPort ?? '—',
  },
  poAcknowledged: {
    label: 'PO Acknowledged',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (e) => formatDate(e.poConfirmedDate),
  },
  prNotes: {
    label: 'PR Notes',
    renderCell: (e) => e.prStatus ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.prStatus} onChange={(ev) => onChange('prStatus', ev.target.value)} />
    ),
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
    renderCell: (e) => e.leadDays ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input type="number" value={form.leadDays} onChange={(ev) => onChange('leadDays', ev.target.value)} style={{ width: 80 }} />
    ),
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
  remarks1: {
    label: 'Remarks 1',
    renderCell: (e) => e.remarks1 ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.remarks1} onChange={(ev) => onChange('remarks1', ev.target.value)} />
    ),
  },
  remarks2: {
    label: 'Remarks 2',
    renderCell: (e) => e.remarks2 ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.remarks2} onChange={(ev) => onChange('remarks2', ev.target.value)} />
    ),
  },
  invoiceNumber: {
    label: 'Invoice Number',
    renderCell: (e) => e.invoiceNumber ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.invoiceNumber} onChange={(ev) => onChange('invoiceNumber', ev.target.value)} />
    ),
  },
  invoiceType: {
    label: 'Invoice Type',
    renderCell: (e) => e.invoiceType ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.invoiceType} onChange={(ev) => onChange('invoiceType', ev.target.value)} />
    ),
  },
  invoiceAmount: {
    label: 'Invoice Amount',
    headerClassName: 'col-right',
    cellClassName: 'col-right',
    renderCell: (e) => formatAmount(e.invoiceAmount),
    renderEditCell: ({ form, onChange }) => (
      <input type="number" step="0.01" value={form.invoiceAmount} onChange={(ev) => onChange('invoiceAmount', ev.target.value)} style={{ width: 110 }} />
    ),
  },
  invoiceCurrency: {
    label: 'Invoice Currency',
    renderCell: (e) => e.invoiceCurrency ?? '—',
    renderEditCell: ({ form, onChange }) => (
      <input value={form.invoiceCurrency} onChange={(ev) => onChange('invoiceCurrency', ev.target.value)} style={{ width: 90 }} maxLength={10} />
    ),
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
  vesselOptions: string[];
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

  vesselFilter: string[];
  onVesselFilterChange: (values: string[]) => void;
}

export function DdTrackerTable({
  entries,
  canEdit,
  vesselOptions,
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
  vesselFilter,
  onVesselFilterChange,
}: Props) {
  const vesselFilterOptions: ColumnFilterOption[] = vesselOptions.map((v) => ({ value: v, label: v }));

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

  const colgroup = (
    <colgroup>
      {canEdit && <col className="col-actions" style={{ width: STICKY_COL_WIDTHS.actions }} />}
      <col className="col-dpr" style={{ width: STICKY_COL_WIDTHS.sno }} />
      <col className="col-status" style={{ width: columnWidths.vessel ?? 190 }} />
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

  const totalCols = columnOrder.length + 2 + (canEdit ? 1 : 0);

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
              <th className={`sticky-col col-status dd-vessel-col${canEdit ? '' : ' col-status-noactions'} sortable-col`} onClick={() => onSort('vesselName')}>
                Vessel{' '}
                <span className="sort-arrow">{sortBy === 'vesselName' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                {!layoutEditable && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <ColumnFilterMenu options={vesselFilterOptions} selected={vesselFilter} onChange={onVesselFilterChange} />
                  </span>
                )}
                {layoutEditable && (
                  <span className="col-resize-handle" onMouseDown={(e) => handleResizeStart('vessel' as ReorderableColumnKey, e)} title="Drag to resize" />
                )}
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
                <td className={`sticky-col col-status${canEdit ? '' : ' col-status-noactions'}`}>
                  <input value={newRowForm.vesselName} onChange={(e) => onNewRowChange('vesselName', e.target.value)} />
                </td>
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
                <tr key={entry.id} className={isEditing ? 'row-editing' : undefined}>
                  {canEdit && (
                    <td className="sticky-col col-actions">
                      {isEditing ? (
                        <div className="row-actions">
                          <button className="icon-btn icon-btn-success" title="Save" onClick={onSaveEdit} disabled={isSavingEdit}>
                            {isSavingEdit ? '…' : '✓'}
                          </button>
                          <button className="icon-btn icon-btn-muted" title="Cancel" onClick={onCancelEdit}>×</button>
                        </div>
                      ) : (
                        <div className="row-actions">
                          <button
                            className="icon-btn"
                            title="Edit"
                            onClick={() => onStartEdit(entry)}
                            disabled={editingId !== null || isAddingNew || layoutEditable}
                          >
                            <EditIcon />
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                  <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{entry.seqNo}</td>
                  <td className={`sticky-col col-status${canEdit ? '' : ' col-status-noactions'}`}>
                    {editCtx ? (
                      <input value={editCtx.form.vesselName} onChange={(e) => onEditFormChange('vesselName', e.target.value)} />
                    ) : (
                      entry.vesselName ?? '—'
                    )}
                  </td>
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
