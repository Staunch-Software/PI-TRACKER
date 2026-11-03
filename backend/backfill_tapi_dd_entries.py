"""Backfill dd_tracker_entries for GCL TAPI DD POs that exist in po_entries/pr_entries but were
never auto-tracked, because SmartPAL's own req_category labels them OPEX-*/ADHOC SPARES/etc.
instead of DD-* even though they're "DD - ..." titled dry-dock items (confirmed with the user
2026-11-03 against the "GCL TAPI - DD - Order Status.xlsx" export).

Only creates entries for POs where a PR row exists (with or without a DD-looking category) --
the small number of POs whose requisition has NO matching pr_entries row at all (likely created
before the scraper's FROM_DATE cutoff) are deliberately EXCLUDED here and printed separately,
pending the purchase team's confirmation on whether to track them (see the "no matching PR"
group in diagnose_untracked_tapi_dd_pos.py's output).

Same insert shape as po_scraper.scraper._sync_dd_tracker_entries, and equally safe to re-run --
skips any PO already tracked (by po_no or by its requisition_no), so this can be run again after
rerunning it with --apply if more rows need covering later.

Usage (from backend/, venv activated):
  venv/bin/python backfill_tapi_dd_entries.py "GCL TAPI - DD - Order Status.xlsx"          # dry run
  venv/bin/python backfill_tapi_dd_entries.py "GCL TAPI - DD - Order Status.xlsx" --apply   # commit
"""
import sys

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry

APPLY = "--apply" in sys.argv
EXCEL_PATH = next((a for a in sys.argv[1:] if not a.startswith("--")), "GCL TAPI - DD - Order Status.xlsx")

wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["rptPOOverview"]
rows = list(ws.iter_rows(min_row=3, max_row=ws.max_row, values_only=True))
po_nos = [r[2] for r in rows if r[2]]

db = SessionLocal()
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}
tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}

to_create = []  # (po, pr_or_none)
no_matching_pr = []  # po_no -- excluded, pending purchase team

for po_no in po_nos:
    if po_no in tracked_po_nos:
        continue
    po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
    if not po:
        continue  # not in po_entries at all -- not this script's concern

    if po.requisition_no:
        if po.requisition_no in tracked_req_nos:
            continue  # already tracked by requisition_no, just missing po_no link -- not this script's job
        pr = db.query(PrEntry).filter(PrEntry.requisition_no == po.requisition_no).first()
        if not pr:
            no_matching_pr.append(po_no)
            continue
        to_create.append((po, pr))
    else:
        to_create.append((po, None))  # Direct PO, no requisition

print(f"Excluded -- requisition has no matching pr_entries row, pending purchase team confirmation ({len(no_matching_pr)}):")
for po_no in no_matching_pr:
    print(f"   {po_no}")

print(f"\n{'=' * 70}\nTo create ({len(to_create)}){'  [DRY RUN -- nothing written]' if not APPLY else '  [APPLYING]'}\n{'=' * 70}")
for po, pr in to_create:
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
