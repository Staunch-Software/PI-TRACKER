"""Backfill dd_tracker_entries for the 4 GCL TAPI DD POs whose requisition has NO matching
pr_entries row (likely created before the scraper's FROM_DATE cutoff, 01-Jul-2026) -- the purchase
team confirmed 2026-11-03 to track these like Direct POs (by po_no), even though they do carry a
requisition_no in po_entries.requisition_no (kept here for reference/search, just with no live PR
join backing it -- PR-related DD Tracker columns will show "--" for these, same as any requisition
not yet scraped).

Companion to backfill_tapi_dd_entries.py, which deliberately excluded these same 4 POs.

Usage (from backend/, venv activated):
  venv/bin/python backfill_tapi_dd_entries_no_pr.py "GCL TAPI - DD - Order Status.xlsx"          # dry run
  venv/bin/python backfill_tapi_dd_entries_no_pr.py "GCL TAPI - DD - Order Status.xlsx" --apply   # commit
"""
import sys

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry

APPLY = "--apply" in sys.argv

# The 4 POs confirmed by the diagnostic (has requisition_no, but no matching pr_entries row).
PO_NOS = [
    "GCTA/O-0531/PO26",
    "GCTA/O-0530/PO26",
    "GCTA/O-0528/PO26",
    "GCTA/O-0484/PO26",
]

db = SessionLocal()
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}

to_create = []
for po_no in PO_NOS:
    if po_no in tracked_po_nos:
        print(f"SKIP {po_no} -- already tracked")
        continue
    po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
    if not po:
        print(f"SKIP {po_no} -- not found in po_entries")
        continue
    to_create.append(po)

print(f"\n{'=' * 70}\nTo create ({len(to_create)}){'  [DRY RUN -- nothing written]' if not APPLY else '  [APPLYING]'}\n{'=' * 70}")
for po in to_create:
    print(f"{po.po_no:20s} req={po.requisition_no or '—':20s} vessel={po.vessel_name:12s} title={po.title}")
    if APPLY:
        db.add(DdTrackerEntry(
            entry_type="DD",
            requisition_no=po.requisition_no,
            po_no=po.po_no,
            vessel_name=po.vessel_name,
            title=po.title,
        ))

if APPLY:
    db.commit()
    print(f"\nCreated {len(to_create)} dd_tracker_entries row(s) and committed.")
else:
    print("\nDry run only -- re-run with --apply to actually create these rows.")

db.close()
