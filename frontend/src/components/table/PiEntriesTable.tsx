import { useLayoutEffect, useRef, useState, type UIEvent } from 'react';
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
import { AttachmentCell } from './AttachmentCell';
import { ExpandableCell } from './ExpandableCell';
import { StatusBadge } from './StatusBadge';

// Fixed pixel widths for the free-text columns. Applied on the inner content wrapper
// (not just the <td>) because the table uses default auto layout, under which a <td>'s own
// width/max-width is only a hint the browser can override based on content in other rows.
const COL_WIDTH = {
  serviceDetails: 460,
  paymentReference: 340,
  lastKnownRemark: 600,
  notes: 340,
};

export type SortColumn =
  | 'dprNo'
  | 'dprDate'
  | 'vesselName'
  | 'vendorName'
  | 'amountInr'
  | 'paymentDate'
  | 'daysSincePayment'
  | 'followupStatus';

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
}

function SortHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  column: SortColumn;
  label: string;
  sortBy: SortColumn | null;
  sortDir: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  className?: string;
}) {
  const isActive = sortBy === column;
  return (
    <th className={`sortable-col${className ? ` ${className}` : ''}`} onClick={() => onSort(column)}>
      {label} <span className="sort-arrow">{isActive ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  );
}

function EditableFields({
  form,
  onChange,
  vessels,
  vendors,
  entry,
  canEdit,
}: {
  form: PiEntryFormState;
  onChange: <K extends keyof PiEntryFormState>(field: K, value: PiEntryFormState[K]) => void;
  vessels: Vessel[];
  vendors: Vendor[];
  entry: PiEntry | null; // null while adding a new row — can't attach files before the PI exists
  canEdit: boolean;
}) {
  return (
    <>
      <td>
        {entry ? (
          <AttachmentCell
            piEntryId={entry.id}
            dprNo={entry.dprNo}
            attachmentCount={entry.attachmentCount}
            canEdit={canEdit}
          />
        ) : (
          '—'
        )}
      </td>
      <td>
        <input value={form.invoiceNo} onChange={(e) => onChange('invoiceNo', e.target.value)} style={{ width: 120 }} />
      </td>
      <td>
        <input type="date" value={form.dprDate} onChange={(e) => onChange('dprDate', e.target.value)} />
      </td>
      <td style={{ minWidth: 200 }}>
        <LookupSelect
          compact
          label="Vessel"
          items={vessels}
          value={form.vesselId}
          onChange={(id) => onChange('vesselId', id)}
          createPath="/vessels"
          queryKey="vessels"
        />
      </td>
      <td style={{ minWidth: 200 }}>
        <LookupSelect
          compact
          label="Vendor"
          items={vendors}
          value={form.vendorId}
          onChange={(id) => onChange('vendorId', id)}
          createPath="/vendors"
          queryKey="vendors"
        />
      </td>
      <td className="col-fixed-wide">
        <input
          value={form.serviceDetails}
          onChange={(e) => onChange('serviceDetails', e.target.value)}
          style={{ width: COL_WIDTH.serviceDetails }}
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={form.amountInr}
          onChange={(e) => onChange('amountInr', e.target.value)}
          style={{ width: 110 }}
        />
      </td>
      <td>
        <input
          type="number"
          step="0.01"
          value={form.fcAmount}
          onChange={(e) => onChange('fcAmount', e.target.value)}
          style={{ width: 100 }}
        />
      </td>
      <td className="col-center">
        <select value={form.currency} onChange={(e) => onChange('currency', e.target.value as Currency)}>
          {Object.values(Currency).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input type="date" value={form.paymentDate} onChange={(e) => onChange('paymentDate', e.target.value)} />
      </td>
      <td className="col-fixed">
        <input
          value={form.paymentReference}
          onChange={(e) => onChange('paymentReference', e.target.value)}
          style={{ width: COL_WIDTH.paymentReference }}
        />
      </td>
      <td className="col-center">—</td>
      <td>
        <select
          value={form.followupStatus}
          onChange={(e) => onChange('followupStatus', e.target.value as FollowUpStatus)}
          style={{ minWidth: 180 }}
        >
          {Object.values(FollowUpStatus).map((s) => (
            <option key={s} value={s}>
              {FOLLOW_UP_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="col-fixed-xwide">
        <input
          value={form.lastKnownRemark}
          onChange={(e) => onChange('lastKnownRemark', e.target.value)}
          style={{ width: COL_WIDTH.lastKnownRemark }}
        />
      </td>
      <td className="col-center">
        <input
          type="date"
          value={form.reminder1SentDate}
          onChange={(e) => onChange('reminder1SentDate', e.target.value)}
        />
      </td>
      <td className="col-center">
        <input
          type="date"
          value={form.reminder2SentDate}
          onChange={(e) => onChange('reminder2SentDate', e.target.value)}
        />
      </td>
      <td className="col-center">
        <input
          type="checkbox"
          checked={form.finalInvoiceReceived}
          onChange={(e) => onChange('finalInvoiceReceived', e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
      </td>
      <td className="col-center">
        <input type="date" value={form.invoiceDate} onChange={(e) => onChange('invoiceDate', e.target.value)} />
      </td>
      <td className="col-center">—</td>
      <td className="col-center">—</td>
      <td className="col-fixed">
        <input value={form.notes} onChange={(e) => onChange('notes', e.target.value)} style={{ width: COL_WIDTH.notes }} />
      </td>
    </>
  );
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
}: Props) {
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerTableRef = useRef<HTMLTableElement>(null);
  const bodyTableRef = useRef<HTMLTableElement>(null);
  const [colWidths, setColWidths] = useState<number[] | null>(null);
  const hasRows = entries.length > 0 || isAddingNew;

  // Columns that already have an explicit CSS width (col-fixed/-wide/-xwide, col-actions,
  // col-dpr) use that known value directly instead of measuring — measuring would pick up
  // ExpandableCell's full unclamped text width (way more than the 340/460/600px the column
  // should stay at). Every OTHER column still gets every one of its <col> entries below, with
  // no gaps: under table-layout:fixed, leaving even one column to size itself from a "hint"
  // (its own cell's CSS width) instead of an explicit <col> width left the browser free to
  // distribute rounding slack there — which is exactly what made the last column (Notes)
  // drift out of sync between the two independently-fixed-layout tables.
  function fixedWidthFor(className: string): number | null {
    if (/\bcol-fixed-xwide\b/.test(className)) return 600;
    if (/\bcol-fixed-wide\b/.test(className)) return 460;
    if (/\bcol-fixed\b/.test(className)) return 340;
    if (/\bcol-actions\b/.test(className)) return 80;
    if (/\bcol-dpr\b/.test(className)) return 140;
    return null;
  }

  // Header and body are separate <table>s (see the .table-header-scroll comment in
  // global.css for why) so they no longer share one auto-layout pass the way one
  // thead/tbody table would, and can each independently settle on different column widths.
  // Force them identical by measuring BOTH — via scrollWidth, which reports a cell's true
  // natural content width even while it's currently constrained by a previous table-fixed
  // pass, so a later column that needs to grow (e.g. a longer value on a new page) still
  // gets picked up — and copying the max of the two onto an identical <colgroup> applied to
  // both tables, so there's no independent per-table algorithm left to diverge between them.
  useLayoutEffect(() => {
    if (!hasRows) return;
    const bodyRows = bodyScrollRef.current?.querySelectorAll('tbody tr');
    const headerRow = headerScrollRef.current?.querySelector('thead tr');
    if (!bodyRows?.length || !headerRow) return;
    const headerCells = Array.from(headerRow.children) as HTMLElement[];

    const widths = headerCells.map((headerCell) => fixedWidthFor(headerCell.className) ?? headerCell.scrollWidth);
    // Scan every currently-rendered row (not just the first) — a flexible column's true
    // required width is whatever its longest value on THIS page needs, and other rows can
    // easily be longer than the first (e.g. a longer payment reference further down).
    bodyRows.forEach((row) => {
      Array.from(row.children).forEach((cell, i) => {
        const el = cell as HTMLElement;
        if (fixedWidthFor(el.className) != null) return;
        widths[i] = Math.max(widths[i], el.scrollWidth);
      });
    });
    setColWidths(widths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, editingId, isAddingNew, canEdit]);

  // Column-by-column the header and body tables now use identical widths, but their SUMS can
  // still differ by a stray sub-pixel here and there (two separate tables independently
  // rounding the same fractional widths). That's enough to give them different scrollWidths,
  // and since scrolling is synced by copying a raw scrollLeft number, the narrower one clamps
  // a few pixels short at the far-right edge — most visible on the last column (Notes), where
  // the header looks like it's stuck early while the body keeps going. Forcing the header
  // table to the body's exact measured width removes the discrepancy at its source.
  useLayoutEffect(() => {
    if (!colWidths || !headerTableRef.current || !bodyTableRef.current) return;
    headerTableRef.current.style.width = `${bodyTableRef.current.scrollWidth}px`;
  }, [colWidths]);

  function syncHeaderScroll(e: UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }

  const colgroup = colWidths && (
    <colgroup>
      {colWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
  const dataTableClassName = colWidths ? 'data-table table-fixed' : 'data-table';

  return (
    <div className="card">
      <div className="table-header-scroll" ref={headerScrollRef}>
        <table className={dataTableClassName} ref={headerTableRef}>
          {colgroup}
          <thead>
            <tr>
              {canEdit && <th className="sticky-col col-actions">Actions</th>}
              <SortHeader column="dprNo" label="DPR No." sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`} />
              <th>Attachment</th>
              <th>Invoice No.</th>
              <SortHeader column="dprDate" label="DPR Date" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>Vessel</th>
              <th>Vendor</th>
              <th className="col-fixed-wide">Service Details</th>
              <SortHeader column="amountInr" label="Amount (INR)" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>FC Amount</th>
              <th className="col-center">Currency</th>
              <SortHeader column="paymentDate" label="Payment Date" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="col-fixed">Payment Reference</th>
              <SortHeader column="daysSincePayment" label="Days Since Payment" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="col-center" />
              <SortHeader column="followupStatus" label="Follow-up Status" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="col-fixed-xwide">Last Known Remark</th>
              <th className="col-center">Reminder 1 Sent</th>
              <th className="col-center">Reminder 2 Sent</th>
              <th className="col-center">Final Invoice Received</th>
              <th className="col-center">Invoice Date</th>
              <th className="col-center">Attached By</th>
              <th className="col-center">Date Attached</th>
              <th className="col-fixed">Notes</th>
            </tr>
          </thead>
        </table>
      </div>
      <div className="table-body-scroll" ref={bodyScrollRef} onScroll={syncHeaderScroll}>
        <table className={dataTableClassName} ref={bodyTableRef}>
          {colgroup}
        <tbody>
          {entries.length === 0 && !isAddingNew && (
            <tr>
              <td colSpan={canEdit ? 23 : 22} className="empty-state">
                No PI entries match the current filters.
              </td>
            </tr>
          )}

          {entries.map((entry) => {
            const isEditing = editingId === entry.id;
            const isHighlighted = highlightId === entry.id;
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
                      <button className="icon-btn" title="Edit" onClick={() => onStartEdit(entry)} disabled={editingId !== null || isAddingNew}>
                        ✎
                      </button>
                    )}
                  </td>
                )}

                {isEditing && editForm ? (
                  <>
                    <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>
                      <input value={editForm.dprNo} onChange={(e) => onEditFormChange('dprNo', e.target.value)} style={{ width: 110 }} />
                    </td>
                    <EditableFields
                      form={editForm}
                      onChange={onEditFormChange}
                      vessels={vessels}
                      vendors={vendors}
                      entry={entry}
                      canEdit={canEdit}
                    />
                  </>
                ) : (
                  <>
                    <td className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`}>{entry.dprNo}</td>
                    <td>
                      <AttachmentCell
                        piEntryId={entry.id}
                        dprNo={entry.dprNo}
                        attachmentCount={entry.attachmentCount}
                        canEdit={canEdit}
                      />
                    </td>
                    <td>{entry.invoiceNo ?? '—'}</td>
                    <td>{formatDate(entry.dprDate)}</td>
                    <td>{entry.vesselName}</td>
                    <td>{entry.vendorName}</td>
                    <td className="col-fixed-wide">
                      <ExpandableCell text={entry.serviceDetails} width={COL_WIDTH.serviceDetails} />
                    </td>
                    <td>{formatAmount(entry.amountInr)}</td>
                    <td>{formatAmount(entry.fcAmount)}</td>
                    <td className="col-center">{entry.currency}</td>
                    <td>{formatDate(entry.paymentDate)}</td>
                    <td className="col-fixed">
                      <ExpandableCell text={entry.paymentReference} width={COL_WIDTH.paymentReference} />
                    </td>
                    <td className="col-center">{entry.daysSincePayment ?? '—'}</td>
                    <td>
                      <StatusBadge status={entry.followupStatus} />
                    </td>
                    <td className="col-fixed-xwide">
                      <ExpandableCell text={entry.lastKnownRemark} width={COL_WIDTH.lastKnownRemark} />
                    </td>
                    <td className="col-center">{formatDate(entry.reminder1SentDate)}</td>
                    <td className="col-center">{formatDate(entry.reminder2SentDate)}</td>
                    <td className="col-center">{entry.finalInvoiceReceived ? 'Yes' : 'No'}</td>
                    <td className="col-center">{formatDate(entry.invoiceDate)}</td>
                    <td className="col-center">{entry.attachedByName ?? '—'}</td>
                    <td className="col-center">{formatDateTime(entry.dateAttached)}</td>
                    <td className="col-fixed">
                      <ExpandableCell text={entry.notes} width={COL_WIDTH.notes} />
                    </td>
                  </>
                )}
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
              <EditableFields
                form={newRowForm}
                onChange={onNewRowChange}
                vessels={vessels}
                vendors={vendors}
                entry={null}
                canEdit={canEdit}
              />
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
