import { FOLLOW_UP_STATUS_LABELS, FollowUpStatus } from '../../shared';

const STATUS_COLORS: Record<FollowUpStatus, { bg: string; color: string }> = {
  [FollowUpStatus.PENDING_NOT_YET_FOLLOWED_UP]: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
  [FollowUpStatus.PENDING_REMINDER_SENT]: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  [FollowUpStatus.PENDING_INTERNAL_CHECK]: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  [FollowUpStatus.PENDING_DISCREPANCY_TO_RESOLVE]: { bg: 'var(--color-danger-bg)', color: 'var(--color-danger)' },
  [FollowUpStatus.PENDING_SCHEDULED]: { bg: 'var(--color-info-bg)', color: 'var(--color-info)' },
  [FollowUpStatus.PENDING_OTHER]: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  [FollowUpStatus.RECEIVED]: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
  [FollowUpStatus.NOT_APPLICABLE]: { bg: 'var(--color-neutral-bg)', color: 'var(--color-neutral)' },
  [FollowUpStatus.ADD_NEW_PI]: { bg: 'var(--color-info-bg)', color: 'var(--color-info)' },
};

export function StatusBadge({ status }: { status: FollowUpStatus }) {
  const { bg, color } = STATUS_COLORS[status];
  return (
    <span className="status-badge" style={{ background: bg, color, border: `1px solid ${color}30` }}>
      <span className="status-badge-dot" style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
      {FOLLOW_UP_STATUS_LABELS[status]}
    </span>
  );
}
