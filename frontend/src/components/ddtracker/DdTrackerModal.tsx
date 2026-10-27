import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { DdTrackerEntry, DdTrackerEntryInput, PoLookupResult, PrLookupResult } from '../../shared';
import { DdTrackerLookupField } from './DdTrackerLookupField';

interface Props {
  entry: DdTrackerEntry | null;
  onClose: () => void;
}

const ENTRY_TYPE_OPTIONS = ['DD', 'OPEX', 'NB', 'PD'];

export function DdTrackerModal({ entry, onClose }: Props) {
  const isEdit = entry !== null;
  const [entryType, setEntryType] = useState(entry?.entryType ?? 'DD');
  const [requisitionNo, setRequisitionNo] = useState(entry?.requisitionNo ?? '');
  const [poNo, setPoNo] = useState(entry?.poNo ?? '');
  const [vesselName, setVesselName] = useState(entry?.vesselName ?? '');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [prStatus, setPrStatus] = useState(entry?.prStatus ?? '');
  const [orderStatus, setOrderStatus] = useState(entry?.orderStatus ?? '');
  const [leadDays, setLeadDays] = useState(entry?.leadDays?.toString() ?? '');
  const [readinessDate, setReadinessDate] = useState(entry?.readinessDate ?? '');
  const [exStock, setExStock] = useState(entry?.exStock ?? '');
  const [supplyConfirmation, setSupplyConfirmation] = useState(entry?.supplyConfirmation ?? '');
  const [remarks1, setRemarks1] = useState(entry?.remarks1 ?? '');
  const [remarks2, setRemarks2] = useState(entry?.remarks2 ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(entry?.invoiceNumber ?? '');
  const [invoiceType, setInvoiceType] = useState(entry?.invoiceType ?? '');
  const [invoiceAmount, setInvoiceAmount] = useState(entry?.invoiceAmount?.toString() ?? '');
  const [invoiceCurrency, setInvoiceCurrency] = useState(entry?.invoiceCurrency ?? '');
  const [paymentStatus, setPaymentStatus] = useState(entry?.paymentStatus ?? '');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: DdTrackerEntryInput = {
        entryType: entryType.trim() || null,
        requisitionNo: requisitionNo.trim() || null,
        poNo: poNo.trim() || null,
        vesselName: vesselName.trim() || null,
        title: title.trim() || null,
        prStatus: prStatus.trim() || null,
        orderStatus: orderStatus.trim() || null,
        leadDays: leadDays.trim() ? Number(leadDays) : null,
        readinessDate: readinessDate || null,
        exStock: exStock.trim() || null,
        supplyConfirmation: supplyConfirmation.trim() || null,
        remarks1: remarks1.trim() || null,
        remarks2: remarks2.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        invoiceType: invoiceType.trim() || null,
        invoiceAmount: invoiceAmount.trim() ? Number(invoiceAmount) : null,
        invoiceCurrency: invoiceCurrency.trim() || null,
        paymentStatus: paymentStatus.trim() || null,
      };
      return isEdit
        ? api.patch<DdTrackerEntry>(`/dd-tracker/${entry.id}`, body)
        : api.post<DdTrackerEntry>('/dd-tracker', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dd-tracker'] });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to save DD Tracker entry.'),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel dd-tracker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? `Edit DD Tracker Entry — S.No ${entry.seqNo}` : 'Add DD Tracker Entry'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="field">
                <label>Type</label>
                <select value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                  {ENTRY_TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Vessel</label>
                <input value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
              </div>
              <div className="field">
                <label>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>

              <DdTrackerLookupField<PrLookupResult>
                label="PR Number"
                value={requisitionNo}
                onChange={setRequisitionNo}
                placeholder="Search by PR number or title…"
                searchPath={(q) => `/dd-tracker/pr-lookup?q=${encodeURIComponent(q)}`}
                renderOption={(r) => ({ key: r.requisitionNo, main: r.requisitionNo, sub: `${r.title ?? ''} — ${r.vesselName ?? ''}` })}
                onSelect={(r) => {
                  setRequisitionNo(r.requisitionNo);
                  if (!vesselName) setVesselName(r.vesselName ?? '');
                  if (!title) setTitle(r.title ?? '');
                }}
              />
              <DdTrackerLookupField<PoLookupResult>
                label="PO Number"
                value={poNo}
                onChange={setPoNo}
                placeholder="Search by PO number or title…"
                searchPath={(q) => `/dd-tracker/po-lookup?q=${encodeURIComponent(q)}`}
                renderOption={(r) => ({ key: r.poNo, main: r.poNo, sub: `${r.vendor ?? ''} — ${r.vesselName ?? ''}` })}
                onSelect={(r) => {
                  setPoNo(r.poNo);
                  if (!vesselName) setVesselName(r.vesselName ?? '');
                  if (!title) setTitle(r.title ?? '');
                }}
              />

              <div className="field">
                <label>PR Status (team notes)</label>
                <input value={prStatus} onChange={(e) => setPrStatus(e.target.value)} />
              </div>
              <div className="field">
                <label>Order Status (team notes)</label>
                <input value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} />
              </div>
              <div className="field">
                <label>Lead Days</label>
                <input type="number" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
              </div>
              <div className="field">
                <label>Readiness Date</label>
                <input type="date" value={readinessDate} onChange={(e) => setReadinessDate(e.target.value)} />
              </div>
              <div className="field">
                <label>Ex-Stock</label>
                <input value={exStock} onChange={(e) => setExStock(e.target.value)} />
              </div>
              <div className="field">
                <label>Supply Confirmation</label>
                <input value={supplyConfirmation} onChange={(e) => setSupplyConfirmation(e.target.value)} />
              </div>
              <div className="field">
                <label>Remarks 1</label>
                <input value={remarks1} onChange={(e) => setRemarks1(e.target.value)} />
              </div>
              <div className="field">
                <label>Remarks 2</label>
                <input value={remarks2} onChange={(e) => setRemarks2(e.target.value)} />
              </div>
              <div className="field">
                <label>Invoice Number</label>
                <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
              </div>
              <div className="field">
                <label>Invoice Type</label>
                <input value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} />
              </div>
              <div className="field">
                <label>Invoice Amount</label>
                <input type="number" step="0.01" value={invoiceAmount} onChange={(e) => setInvoiceAmount(e.target.value)} />
              </div>
              <div className="field">
                <label>Invoice Currency</label>
                <input value={invoiceCurrency} onChange={(e) => setInvoiceCurrency(e.target.value)} maxLength={10} />
              </div>
              <div className="field">
                <label>Payment Status</label>
                <input value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} />
              </div>
            </div>
            {error && <p className="form-error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
