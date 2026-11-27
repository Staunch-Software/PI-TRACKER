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
    <div className="modal-overlay soa-modal-overlay" onClick={onClose}>
      <div className="modal-panel soa-modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header soa-modal-header">
          <h2 className="soa-modal-title">
            <div className="soa-modal-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            {vendorLabel}
            <span className="soa-modal-subtitle">
              — {items.length} line item{items.length === 1 ? '' : 's'}
            </span>
          </h2>
          <button className="soa-modal-close-icon" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="modal-body soa-modal-body">
          <div className="pir-table-scroll" style={{ border: 'none', borderRadius: 0 }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: '32px' }}>Invoice No.</th>
                  <th>Vessel</th>
                  <th>Invoice Date</th>
                  <th>Amount</th>
                  <th>Remaining</th>
                  <th>Currency</th>
                  <th style={{ paddingRight: '32px', whiteSpace: 'nowrap', width: '260px' }}>Match Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ paddingLeft: '32px', fontWeight: 500 }}>{item.invoiceNumber}</td>
                    <td>{item.vesselName ?? item.vesselNameRaw ?? '—'}</td>
                    <td>{formatDate(item.invoiceDate)}</td>
                    <td style={{ fontWeight: 500 }}>{formatAmount(item.amount)}</td>
                    <td style={{ fontWeight: 500 }}>{formatAmount(item.remainingAmount)}</td>
                    <td><span className="soa-currency-badge">{item.currency ?? '—'}</span></td>
                    <td style={{ paddingRight: '32px', whiteSpace: 'nowrap', overflow: 'visible', textOverflow: 'clip' }}>
                      <SoaMatchBadge matchSource={item.matchSource} matchStatusLabel={item.matchStatusLabel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer soa-modal-footer">
          <button type="button" className="soa-btn-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
