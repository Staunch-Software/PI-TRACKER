import type { SoaLineItem } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import { SoaMatchBadge } from './SoaMatchBadge';

interface Props {
  vendorLabel: string;
  items: SoaLineItem[];
  onClose: () => void;
}

export function SoaVendorDetailModal({ vendorLabel, items, onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 1000, width: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{vendorLabel} — {items.length} line item{items.length === 1 ? '' : 's'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'auto' }}>
          <table className="data-table" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Vessel</th>
                <th>Invoice Date</th>
                <th>Amount</th>
                <th>Remaining</th>
                <th>Currency</th>
                <th>Match Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.invoiceNumber}</td>
                  <td>{item.vesselName ?? item.vesselNameRaw ?? '—'}</td>
                  <td>{formatDate(item.invoiceDate)}</td>
                  <td>{formatAmount(item.amount)}</td>
                  <td>{formatAmount(item.remainingAmount)}</td>
                  <td>{item.currency ?? '—'}</td>
                  <td>
                    <SoaMatchBadge matchSource={item.matchSource} matchStatusLabel={item.matchStatusLabel} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
