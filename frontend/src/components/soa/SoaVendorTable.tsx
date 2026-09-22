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
                <td style={{ textAlign: 'center' }}>{g.hasAttachment ? '📎' : '—'}</td>
                <td style={{ textAlign: 'center' }}>{g.items.length}</td>
                <td style={{ textAlign: 'center' }}>
                  {g.needsTriageCount > 0 ? (
                    <span className="status-badge" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                      {g.needsTriageCount}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {Object.entries(g.outstandingByCurrency)
                    .map(([code, amount]) => `${code} ${formatAmount(amount)}`)
                    .join(' · ')}
                </td>
                <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
