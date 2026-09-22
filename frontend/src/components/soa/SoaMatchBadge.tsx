import { SOA_MATCH_SOURCE_LABELS, SoaMatchSource } from '../../shared';

const MATCH_SOURCE_COLORS: Record<SoaMatchSource, { bg: string; color: string }> = {
  [SoaMatchSource.SMARTPAL]: { bg: 'var(--color-info-bg)', color: 'var(--color-info)' },
  [SoaMatchSource.PIR]: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  [SoaMatchSource.INVOICE_MAIL]: { bg: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' },
  [SoaMatchSource.NONE]: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
};

interface Props {
  matchSource: SoaMatchSource;
  matchStatusLabel: string | null;
}

// Shows WHERE the invoice currently lives, not just found/not-found — see SoaLineItem docstring
// (backend/app/models/soa_line_item.py) for why that distinction matters. matchStatusLabel is
// the actual current state at that source (e.g. SmartPAL's own status text, "Needs Triage" for
// PIR); falls back to the source label alone when no finer-grained status is available.
export function SoaMatchBadge({ matchSource, matchStatusLabel }: Props) {
  const { bg, color } = MATCH_SOURCE_COLORS[matchSource];
  const label =
    matchSource === SoaMatchSource.NONE
      ? SOA_MATCH_SOURCE_LABELS[matchSource]
      : `${SOA_MATCH_SOURCE_LABELS[matchSource]} — ${matchStatusLabel ?? 'Unknown'}`;
  return (
    <span className="status-badge" style={{ background: bg, color }}>
      {label}
    </span>
  );
}
