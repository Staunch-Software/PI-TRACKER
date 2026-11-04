"""
Read-only verification for the "DD-titled but not DD-categorized" auto-sync added to
_sync_dd_tracker_entries() (see app/services/po_scraper/scraper.py, 2026-11-04).

Lists every PR/PO whose own title is DD-prefixed (per the scraper's own _is_dd_title) even though
its SmartPAL req_category isn't DD-flavored, and reports whether each one now has a
dd_tracker_entries row. Run this right after a pi_tracker_po_scrape.service run to confirm the new
auto-sync path actually picked them up.

Usage (from backend/, on the VM):
  venv/bin/python verify_dd_title_autosync.py
"""
import sys

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.services.po_scraper.scraper import _is_dd_category, _is_dd_title

db = SessionLocal()

tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}

title_only_prs = [
    pr for pr in db.query(PrEntry).all()
    if _is_dd_title(pr.title) and not _is_dd_category(pr.req_category)
]
title_only_direct_pos = [
    po for po in db.query(PoEntry).filter(PoEntry.requisition_no.is_(None)).all()
    if _is_dd_title(po.title) and not _is_dd_category(po.req_category)
]

print(f"PR rows matched by title only (category says NO): {len(title_only_prs)}")
pr_tracked = [pr for pr in title_only_prs if pr.requisition_no in tracked_req_nos]
pr_missing = [pr for pr in title_only_prs if pr.requisition_no not in tracked_req_nos]
print(f"  -> now in dd_tracker_entries: {len(pr_tracked)}")
print(f"  -> still missing:             {len(pr_missing)}")
for pr in pr_missing:
    print(f"     MISSING  req={pr.requisition_no}  category={pr.req_category!r}  title={pr.title!r}")

print(f"\nDirect PO rows matched by title only (category says NO): {len(title_only_direct_pos)}")
po_tracked = [po for po in title_only_direct_pos if po.po_no in tracked_po_nos]
po_missing = [po for po in title_only_direct_pos if po.po_no not in tracked_po_nos]
print(f"  -> now in dd_tracker_entries: {len(po_tracked)}")
print(f"  -> still missing:             {len(po_missing)}")
for po in po_missing:
    print(f"     MISSING  po={po.po_no}  category={po.req_category!r}  title={po.title!r}")

print("\nSample of newly title-matched entries now tracked:")
for pr in pr_tracked[:10]:
    entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.requisition_no == pr.requisition_no).first()
    print(f"   req={pr.requisition_no}  category={pr.req_category!r}  entry_id={entry.id if entry else None}  title={pr.title!r}")
for po in po_tracked[:10]:
    entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.po_no == po.po_no).first()
    print(f"   po={po.po_no}  category={po.req_category!r}  entry_id={entry.id if entry else None}  title={po.title!r}")

db.close()
