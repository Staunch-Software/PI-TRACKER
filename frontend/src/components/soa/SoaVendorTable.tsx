import { useMemo, useState } from 'react';
import type { SoaLineItem } from '../../shared';
import { formatAmount, formatDateTime } from '../../lib/format';
import { SoaVendorDetailModal } from './SoaVendorDetailModal';

interface VendorGroup {
  canonicalDomain: string;
  vendorLabel: string;
  items: SoaLineItem[];
  hasAttachment: boolean;
  soaSubject: string | null;
  soaReceivedAt: string;
  needsTriageCount: number;
  outstandingByCurrency: Record<string, number>;
}

interface Props {
  items: SoaLineItem[];
}

// Only ONE current soa_documents row ever exists per canonical vendor at a time (see
// SoaDocument docstring on versioning/supersession), so every line item in a group shares the
// same parent document metadata (hasAttachment, soaSubject, soaReceivedAt) — safe to read that
// off the first item rather than needing to de-duplicate per-document separately.
function groupByVendor(items: SoaLineItem[]): VendorGroup[] {
  const map = new Map<string, SoaLineItem[]>();
  for (const item of items) {
    const bucket = map.get(item.canonicalDomain);
    if (bucket) bucket.push(item);
    else map.set(item.canonicalDomain, [item]);
  }

  return Array.from(map.entries())
    .map(([canonicalDomain, groupItems]) => {
      const first = groupItems[0];
      const outstandingByCurrency: Record<string, number> = {};
      let needsTriageCount = 0;
      for (const item of groupItems) {
        if (item.matchSource === 'NONE') needsTriageCount += 1;
        const amount = item.remainingAmount ?? item.amount;
        if (amount !== null) {
          const n = typeof amount === 'string' ? parseFloat(amount) : amount;
          const currency = item.currency ?? '—';
          outstandingByCurrency[currency] = (outstandingByCurrency[currency] ?? 0) + n;
        }
      }
      return {
        canonicalDomain,
        vendorLabel: first.vendorNameRaw ?? canonicalDomain,
        items: groupItems,
        hasAttachment: first.hasAttachment,
        soaSubject: first.soaSubject,
        soaReceivedAt: first.soaReceivedAt,
        needsTriageCount,
        outstandingByCurrency,
      };
    })
    .sort((a, b) => new Date(b.soaReceivedAt).getTime() - new Date(a.soaReceivedAt).getTime());
}

export function SoaVendorTable({ items }: Props) {
  const groups = useMemo(() => groupByVendor(items), [items]);
  const [selectedVendor, setSelectedVendor] = useState<VendorGroup | null>(null);

  if (groups.length === 0) {
    return <div className="empty-state">No SOA line items match this filter.</div>;
  }

  return (
    <>
      <div className="pir-table-scroll">
        <table className="data-table">
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: 'auto' }} />
            <col style={{ width: '160px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Vendor</th>
              <th style={{ textAlign: 'center' }}>Attachment</th>
              <th style={{ textAlign: 'center' }}>Line Items</th>
              <th style={{ textAlign: 'center' }}>Needs Triage</th>
              <th>Outstanding</th>
              <th>SOA Subject</th>
              <th>SOA Received</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.canonicalDomain} onClick={() => setSelectedVendor(g)} style={{ cursor: 'pointer' }}>
                <td>{g.vendorLabel}</td>
                <td style={{ textAlign: 'center' }}>
                  {g.hasAttachment ? (
                    <div className="attachment-cell soa-attachment-cell-wrap">
                      <button type="button" className="attachment-view-btn" title="SOA Document Attached" style={{ pointerEvents: 'none' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        <span className="attachment-count">1</span>
                      </button>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <span className="pir-status-badge soa-status-badge-info">
                    {g.items.length} item{g.items.length === 1 ? '' : 's'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {g.needsTriageCount > 0 ? (
                    <span className="pir-status-badge soa-status-badge-danger">
                      {g.needsTriageCount} pending
                    </span>
                  ) : (
                    <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                  )}
                </td>
                <td>
                  {Object.entries(g.outstandingByCurrency)
                    .map(([code, amount]) => `${code} ${formatAmount(amount)}`)
                    .join(' · ')}
                </td>
                <td title={g.soaSubject ?? undefined} style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {g.soaSubject ?? '—'}
                </td>
                <td>{formatDateTime(g.soaReceivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedVendor && (
        <SoaVendorDetailModal
          vendorLabel={selectedVendor.vendorLabel}
          items={selectedVendor.items}
          onClose={() => setSelectedVendor(null)}
        />
      )}
    </>
  );
}
