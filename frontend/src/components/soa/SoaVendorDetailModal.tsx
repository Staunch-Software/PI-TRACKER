import { Fragment, useMemo } from 'react';
import type { SoaLineItem } from '../../shared';
import { formatAmount, formatDate } from '../../lib/format';
import { SoaMatchBadge } from './SoaMatchBadge';

interface Props {
  vendorLabel: string;
  items: SoaLineItem[];
  onClose: () => void;
}

const NO_DATE_KEY = '__no_date__';

interface DateGroup {
  key: string;
  invoiceDate: string | null;
  items: SoaLineItem[];
  subtotalByCurrency: Record<string, number>;
}

// Oldest invoice date first — an unpaid-invoice follow-up list reads as an aging report, where
// the longest-outstanding items are the ones that most need chasing. Items with no recognized
// invoice date (a vendor layout that doesn't name one per line, or an unparsed placeholder) sort
// last under their own "No Date" group rather than being guessed into any date bucket.
function groupByInvoiceDate(items: SoaLineItem[]): DateGroup[] {
  const map = new Map<string, SoaLineItem[]>();
  for (const item of items) {
    const key = item.invoiceDate ?? NO_DATE_KEY;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }

  const groups = Array.from(map.entries()).map(([key, groupItems]) => {
    const subtotalByCurrency: Record<string, number> = {};
    for (const item of groupItems) {
      const amount = item.remainingAmount ?? item.amount;
      if (amount !== null) {
        const n = typeof amount === 'string' ? parseFloat(amount) : amount;
        const currency = item.currency ?? '—';
        subtotalByCurrency[currency] = (subtotalByCurrency[currency] ?? 0) + n;
      }
    }
    return {
      key,
      invoiceDate: key === NO_DATE_KEY ? null : key,
      items: groupItems.sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber)),
      subtotalByCurrency,
    };
  });

  return groups.sort((a, b) => {
    if (a.invoiceDate === null) return 1;
    if (b.invoiceDate === null) return -1;
    return a.invoiceDate.localeCompare(b.invoiceDate);
  });
}

export function SoaVendorDetailModal({ vendorLabel, items, onClose }: Props) {
  const groups = useMemo(() => groupByInvoiceDate(items), [items]);
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
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="soa-date-group-row">
                      <td colSpan={7}>
                        <span className="soa-date-group-label">
                          {group.invoiceDate === null ? 'No Invoice Date' : formatDate(group.invoiceDate)}
                        </span>
                        <span className="soa-date-group-count">
                          {group.items.length} item{group.items.length === 1 ? '' : 's'}
                        </span>
                        <span className="soa-date-group-subtotal">
                          {Object.entries(group.subtotalByCurrency)
                            .map(([code, amount]) => `${code} ${formatAmount(amount)}`)
                            .join(' · ')}
                        </span>
                      </td>
                    </tr>
                    {group.items.map((item) => (
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
                  </Fragment>
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
