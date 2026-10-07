import { useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type UIEvent } from 'react';
import { OilType, type LandingReport, type Vessel } from '../../shared';
import { formatDate } from '../../lib/format';
import { EditIcon } from '../common/EditIcon';
import { TrashIcon } from '../common/TrashIcon';
import { ColumnFilterMenu, type ColumnFilterOption } from '../table/ColumnFilterMenu';

// Fixed pixel widths for the sticky columns (Actions / S.No) — never reorderable or resizable,
// so they stay out of the width map that Edit Layout mutates. Same convention as PiEntriesTable.
const STICKY_COL_WIDTHS = {
  actions: 110,
  sno: 80,
} as const;

// Every reorderable column's default width — static and hardcoded (not measured off the DOM), for
// the same reason as PiEntriesTable's DEFAULT_COL_WIDTHS: the header and body are two separate
// tables, so there must be nothing left to measure that could round differently between them.
export const DEFAULT_COL_WIDTHS = {
  vessel: 180,
  port: 220,
  oilType: 160,
  offlandedDate: 170,
  shipmentStatus: 240,
  reportStatus: 240,
} as const;

export type ReorderableColumnKey = keyof typeof DEFAULT_COL_WIDTHS;

// Vessel Name is not listed here: it is pinned as a fixed column right after S.No (see the
// hand-written <th>/<td> below), though its width stays user-resizable.
export const DEFAULT_COLUMN_ORDER = [
  'port', 'oilType', 'offlandedDate', 'shipmentStatus', 'reportStatus',
] as const satisfies readonly ReorderableColumnKey[];

const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 1000;

export type SortColumn =
  | 'seqNo'
  | 'vesselName'
  | 'port'
  | 'oilType'
  | 'offlandedDate'
  | 'shipmentStatus'
  | 'reportStatus';

interface ColumnDef {
  label: string;
  sortColumn: SortColumn;
  headerClassName?: string;
  cellClassName?: string;
  renderCell: (report: LandingReport) => ReactNode;
}

const COLUMNS: Record<ReorderableColumnKey, ColumnDef> = {
  vessel: {
    label: 'Vessel Name',
    sortColumn: 'vesselName',
    renderCell: (r) => r.vesselName,
  },
  port: {
    label: 'Port',
    sortColumn: 'port',
    renderCell: (r) => r.port ?? '—',
  },
  oilType: {
    label: 'Oil Type',
    sortColumn: 'oilType',
    renderCell: (r) => r.oilType,
  },
  offlandedDate: {
    label: 'Offlanded Date',
    sortColumn: 'offlandedDate',
    headerClassName: 'col-center',
    cellClassName: 'col-center',
    renderCell: (r) => formatDate(r.offlandedDate),
  },
  shipmentStatus: {
    label: 'Shipment Status',
    sortColumn: 'shipmentStatus',
    renderCell: (r) => r.shipmentStatus ?? '—',
  },
  reportStatus: {
    label: 'Report Status',
    sortColumn: 'reportStatus',
    renderCell: (r) => r.reportStatus ?? '—',
  },
};

interface Props {
  reports: LandingReport[];
  canEdit: boolean;
  vessels: Vessel[];
  sortBy: SortColumn | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  onEdit: (report: LandingReport) => void;
  onDelete: (report: LandingReport) => void;
  columnOrder: ReorderableColumnKey[];
  columnWidths: Record<string, number>;
  layoutEditable: boolean;
  onReorderColumn: (newOrder: ReorderableColumnKey[]) => void;
  onResizeColumn: (key: ReorderableColumnKey, width: number) => void;
  columnFilters: Record<string, string[]>;
  onColumnFilterChange: (key: string, values: string[]) => void;
}

export function LandingReportsTable({
  reports,
  canEdit,
  vessels,
  sortBy,
  sortDir,
  onSort,
  onEdit,
  onDelete,
  columnOrder,
  columnWidths,
  layoutEditable,
  onReorderColumn,
  onResizeColumn,
  columnFilters,
  onColumnFilterChange,
}: Props) {
  // Vessel options come from live data, so (unlike Oil Type's fixed enum) they're derived here.
  const vesselFilterOptions = useMemo(() => vessels.map((v) => ({ value: v.id, label: v.name })), [vessels]);
  const oilTypeFilterOptions: ColumnFilterOption[] = useMemo(
    () => Object.values(OilType).map((o) => ({ value: o, label: o })),
    []
  );

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
      <col className="col-status" style={{ width: columnWidths.vessel ?? DEFAULT_COL_WIDTHS.vessel }} />
      {columnOrder.map((key) => (
        <col key={key} style={{ width: columnWidths[key] ?? DEFAULT_COL_WIDTHS[key] }} />
      ))}
    </colgroup>
  );

  function renderHeaderCell(key: ReorderableColumnKey) {
    const def = COLUMNS[key];
    const filterOptions = key === 'oilType' ? oilTypeFilterOptions : undefined;
    const classNames = [
      def.headerClassName,
      'sortable-col',
      layoutEditable ? 'col-layout-editable' : undefined,
      dragOverKey === key ? 'col-drag-over' : undefined,
      filterOptions && !layoutEditable ? 'col-has-filter' : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <th
        key={key}
        className={classNames}
        draggable={layoutEditable}
        onDragStart={layoutEditable ? () => handleDragStart(key) : undefined}
        onDragOver={layoutEditable ? (e) => handleDragOver(key, e) : undefined}
        onDrop={layoutEditable ? () => handleDrop(key) : undefined}
        onDragEnd={layoutEditable ? handleDragEnd : undefined}
        onClick={!layoutEditable ? () => onSort(def.sortColumn) : undefined}
      >
        {def.label}
        {!layoutEditable && (
          <span className="sort-arrow">{sortBy === def.sortColumn ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
        )}
        {filterOptions && !layoutEditable && (
          <span onClick={(e) => e.stopPropagation()}>
            <ColumnFilterMenu
              options={filterOptions}
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
              <th
                className={`sticky-col col-status landing-vessel-col${canEdit ? '' : ' col-status-noactions'} sortable-col`}
                onClick={() => onSort('vesselName')}
              >
                Vessel Name{' '}
                <span className="sort-arrow">{sortBy === 'vesselName' ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                {!layoutEditable && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <ColumnFilterMenu
                      options={vesselFilterOptions}
                      selected={columnFilters.vessel ?? []}
                      onChange={(values) => onColumnFilterChange('vessel', values)}
                    />
                  </span>
                )}
                {layoutEditable && (
                  <span className="col-resize-handle" onMouseDown={(e) => handleResizeStart('vessel', e)} title="Drag to resize" />
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
            {reports.length === 0 && (
              <tr>
                <td colSpan={columnOrder.length + (canEdit ? 3 : 2)} className="empty-state">
                  No landing reports match the current filters.
                </td>
              </tr>
            )}
            {reports.map((report) => (
              <tr key={report.id}>
                {canEdit && (
                  <td className="sticky-col col-actions">
                    <div className="row-actions">
                      <button className="icon-btn" title="Edit" onClick={() => onEdit(report)} disabled={layoutEditable}>
                        <EditIcon />
                      </button>
                      <button
                        className="icon-btn icon-btn-danger"
                        title="Delete"
                        onClick={() => onDelete(report)}
                        disabled={layoutEditable}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                )}
                <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{report.seqNo}</td>
                <td className={`sticky-col col-status${canEdit ? '' : ' col-status-noactions'}`}>{report.vesselName}</td>
                {columnOrder.map((key) => {
                  const def = COLUMNS[key];
                  return (
                    <td key={key} className={def.cellClassName}>
                      {def.renderCell(report)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
