import { useEffect, useRef, type FocusEvent, type UIEvent } from 'react';
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
import { AttachmentCell } from './AttachmentCell';
import { ExpandableCell } from './ExpandableCell';
import { StatusBadge } from './StatusBadge';

// Fixed pixel widths for the free-text columns. Applied on the inner content wrapper
// (not just the <td>) because a <td>'s own width is just a hint under table-layout:fixed —
// the <colgroup> below (COL_WIDTHS) is what's actually authoritative.
const COL_WIDTH = {
  serviceDetails: 460,
  paymentReference: 340,
  // Sized for realistic remarks (2-line clamp via ExpandableCell) — the longest seen so far,
  // "Final Invoice will be sent after Installation at Vizag- 22nd July 2026" (~72 chars), fits
  // comfortably in 2 lines at this width. Was 600, which left a lot of dead space since most
  // remarks are one short sentence.
  lastKnownRemark: 300,
  notes: 340,
};

// Every column's width, static and hardcoded — used to build an identical <colgroup> for both
// the header and body <table>s (see PiEntriesTable's render and the .table-header-scroll
// comment in global.css for why they're two separate tables). Deliberately NOT measured off
// the DOM at runtime: two independently-laid-out tables given "the same" measured widths could
// still round fractional pixels differently, and that drift compounds left-to-right, landing
// worst on the rightmost columns (Attached By / Date Attached / Notes). A static width has
// nothing left to measure, so nothing can diverge between the two tables.
const COL_WIDTHS = {
  actions: 80,
  dpr: 140,
  attachment: 90,
  invoiceNo: 130,
  dprDate: 110,
  vessel: 170,
  vendor: 220,
  serviceDetails: COL_WIDTH.serviceDetails,
  amountInr: 130,
  fcAmount: 110,
  currency: 100,
  paymentDate: 120,
  paymentReference: COL_WIDTH.paymentReference,
  daysSincePayment: 150,
  // Wide enough for the longest label ("Pending - Discrepancy to Resolve") on one line without
  // the badge getting silently hard-clipped — see .col-status in global.css for the overflow
  // fallback that also guards against this if a future label ends up even longer.
  followupStatus: 260,
  lastKnownRemark: COL_WIDTH.lastKnownRemark,
  reminder1: 140,
  reminder2: 140,
  finalInvoiceReceived: 160,
  invoiceDate: 120,
  attachedBy: 120,
  dateAttached: 170,
  notes: COL_WIDTH.notes,
} as const;

// Column order exactly as rendered below, with and without the Actions column (canEdit).
const COLUMN_ORDER_WITH_ACTIONS = [
  'actions', 'dpr', 'attachment', 'invoiceNo', 'dprDate', 'vessel', 'vendor', 'serviceDetails',
  'amountInr', 'fcAmount', 'currency', 'paymentDate', 'paymentReference', 'daysSincePayment',
  'followupStatus', 'lastKnownRemark', 'reminder1', 'reminder2', 'finalInvoiceReceived',
  'invoiceDate', 'attachedBy', 'dateAttached', 'notes',
] as const satisfies readonly (keyof typeof COL_WIDTHS)[];
const COLUMN_ORDER_NO_ACTIONS = COLUMN_ORDER_WITH_ACTIONS.filter((c) => c !== 'actions');

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
      <td className="col-vendor" style={{ minWidth: 220 }}>
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
        <input value={form.serviceDetails} onChange={(e) => onChange('serviceDetails', e.target.value)} />
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
        <SearchableSelect
          options={Object.values(Currency).map((c) => ({ value: c, label: c }))}
          value={form.currency}
          onChange={(v) => onChange('currency', v as Currency)}
        />
      </td>
      <td>
        <input type="date" value={form.paymentDate} onChange={(e) => onChange('paymentDate', e.target.value)} />
      </td>
      <td className="col-fixed">
        <input value={form.paymentReference} onChange={(e) => onChange('paymentReference', e.target.value)} />
      </td>
      <td className="col-center">—</td>
      <td className="col-status">
        <SearchableSelect
          options={Object.values(FollowUpStatus).map((s) => ({ value: s, label: FOLLOW_UP_STATUS_LABELS[s] }))}
          value={form.followupStatus}
          onChange={(v) => onChange('followupStatus', v as FollowUpStatus)}
        />
      </td>
      <td className="col-fixed-xwide">
        <input value={form.lastKnownRemark} onChange={(e) => onChange('lastKnownRemark', e.target.value)} />
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
        <input value={form.notes} onChange={(e) => onChange('notes', e.target.value)} />
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

  const columnOrder = canEdit ? COLUMN_ORDER_WITH_ACTIONS : COLUMN_ORDER_NO_ACTIONS;
  const colgroup = (
    <colgroup>
      {columnOrder.map((col) => (
        <col key={col} style={{ width: COL_WIDTHS[col] }} />
      ))}
    </colgroup>
  );

  return (
    <div className="card">
      <div className="table-header-scroll" ref={headerScrollRef}>
        <table className="data-table">
          {colgroup}
          <thead>
            <tr>
              {canEdit && <th className="sticky-col col-actions">Actions</th>}
              <SortHeader column="dprNo" label="DPR No." sortBy={sortBy} sortDir={sortDir} onSort={onSort} className={`sticky-col col-dpr${canEdit ? '' : ' col-dpr-noactions'}`} />
              <th>Attachment</th>
              <th>Invoice No.</th>
              <SortHeader column="dprDate" label="DPR Date" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>Vessel</th>
              <th className="col-vendor">Vendor</th>
              <th className="col-fixed-wide">Service Details</th>
              <SortHeader column="amountInr" label="Amount (INR)" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>FC Amount</th>
              <th className="col-center">Currency</th>
              <SortHeader column="paymentDate" label="Payment Date" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th className="col-fixed">Payment Reference</th>
              <SortHeader column="daysSincePayment" label="Days Since Payment" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="col-center" />
              <SortHeader column="followupStatus" label="Follow-up Status" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="col-status" />
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
      <div className="table-body-scroll" ref={bodyScrollRef} onScroll={syncHeaderScroll} onFocus={handleEditingFocus}>
        <table className="data-table">
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
                    <td className="col-vendor">
                      <ExpandableCell text={entry.vendorName} />
                    </td>
                    <td className="col-fixed-wide">
                      <ExpandableCell text={entry.serviceDetails} />
                    </td>
                    <td>{formatAmount(entry.amountInr)}</td>
                    <td>{formatAmount(entry.fcAmount)}</td>
                    <td className="col-center">{entry.currency}</td>
                    <td>{formatDate(entry.paymentDate)}</td>
                    <td className="col-fixed">
                      <ExpandableCell text={entry.paymentReference} />
                    </td>
                    <td className="col-center">{entry.daysSincePayment ?? '—'}</td>
                    <td className="col-status">
                      <StatusBadge status={entry.followupStatus} />
                    </td>
                    <td className="col-fixed-xwide">
                      <ExpandableCell text={entry.lastKnownRemark} />
                    </td>
                    <td className="col-center">{formatDate(entry.reminder1SentDate)}</td>
                    <td className="col-center">{formatDate(entry.reminder2SentDate)}</td>
                    <td className="col-center">{entry.finalInvoiceReceived ? 'Yes' : 'No'}</td>
                    <td className="col-center">{formatDate(entry.invoiceDate)}</td>
                    <td className="col-center">{entry.attachedByName ?? '—'}</td>
                    <td className="col-center">{formatDateTime(entry.dateAttached)}</td>
                    <td className="col-fixed">
                      <ExpandableCell text={entry.notes} />
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
