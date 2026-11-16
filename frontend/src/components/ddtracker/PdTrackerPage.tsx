import { DdTrackerPage } from './DdTrackerPage';

// PD (Pre-Delivery) Tracker — a fully separate module from DD Tracker (own nav link, own
// can_access_pd flag, own /pd-tracker backend prefix), added 2026-11-12 per direct user request:
// "replicate DD Tracker for PD". This is deliberately just a thin wrapper around DdTrackerPage
// (parameterized with this category's own API path/table-layout key/copy) rather than a
// copy-pasted ~2500-line duplicate — see DdTrackerPage's own props docstring for why.
export function PdTrackerPage() {
  return (
    <DdTrackerPage
      apiBasePath="/pd-tracker"
      tableLayoutKey="pd_tracker"
      pageTitle="PD Tracker"
      moduleLabel="PD Tracker"
      defaultVessel={null}
      bannerText={
        <>
          Entries for every "PD" category PR/PO, plus any other PR/PO whose own title starts with "PD", are added
          automatically from the SmartPAL scrape (twice daily). Use "Add Entry" — with the PR/PO Number lookup — only
          for items that need tracking here but SmartPAL neither categorizes nor titles as PD.
        </>
      }
    />
  );
}
