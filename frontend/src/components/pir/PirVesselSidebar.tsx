export const NO_VESSEL_GROUP = 'No vessel assigned';
export const UNMATCHED_VESSEL_GROUP = 'Not in Fleet';

export interface SidebarBucket {
  vesselGroup: string;
  count: number;
}

interface Props {
  buckets: SidebarBucket[];
  selected: string | null;
  onSelect: (vesselGroup: string) => void;
}

const TRIAGE_ORDER = [NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP];

// Left rail of the split-view — every vessel/bucket as a row, "No vessel assigned" and
// "Not in Fleet" pinned in their own "Needs Triage" section (red accent) above the real fleet
// list, styled distinctly per the task ("Needs triage" vs "Fleet"). No existing left-rail-list
// component in this app to match (AdminLayout's sidebar is nav links, not selectable data rows),
// so this mirrors .admin-sidebar's structural shape (fixed width, own scroll) without reusing its
// nav-link styling, which doesn't fit a row that also carries a count badge.
export function PirVesselSidebar({ buckets, selected, onSelect }: Props) {
  const triage = TRIAGE_ORDER.map((name) => buckets.find((b) => b.vesselGroup === name)).filter(
    (b): b is SidebarBucket => !!b && b.count > 0
  );
  const fleet = buckets
    .filter((b) => !TRIAGE_ORDER.includes(b.vesselGroup))
    .sort((a, b) => b.count - a.count);

  function renderRow(bucket: SidebarBucket, isTriage: boolean) {
    return (
      <div
        key={bucket.vesselGroup}
        className={`pir-sidebar-row${selected === bucket.vesselGroup ? ' active' : ''}${isTriage ? ' needs-triage-row' : ''}`}
        onClick={() => onSelect(bucket.vesselGroup)}
      >
        <span>{bucket.vesselGroup}</span>
        <span className="pir-sidebar-count">{bucket.count}</span>
      </div>
    );
  }

  return (
    <div className="pir-sidebar">
      {triage.length > 0 && (
        <>
          <div className="pir-sidebar-section-heading needs-triage">Needs Triage</div>
          {triage.map((b) => renderRow(b, true))}
        </>
      )}
      <div className="pir-sidebar-section-heading">Fleet</div>
      {fleet.length === 0 ? (
        <div style={{ padding: '14px', fontSize: 13, color: 'var(--color-text-muted)' }}>No matching invoices.</div>
      ) : (
        fleet.map((b) => renderRow(b, false))
      )}
    </div>
  );
}
