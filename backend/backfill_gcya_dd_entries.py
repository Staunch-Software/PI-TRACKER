"""Backfill dd_tracker_entries for GCL Yamuna DD/OPEX items from the team's own tracker Excel.

Rules confirmed with user 2026-11-03:
  - A row is DD/OPEX-relevant if Category is "DD"/"OPEX", OR Category is blank but the title
    starts with "DD" (same gap as the GCL TAPI fix -- SmartPAL's own category doesn't always
    agree with the team's real DD/OPEX classification).
  - If the row's PO Number matches a real po_entries row: track by that po_no (+ requisition_no,
    vessel_name, title from po_entries).
  - If the PO Number does NOT match po_entries (typo, or not yet scraped) OR the row simply has
    no PO Number yet (still at PR/enquiry stage): track by PR Number alone (po_no left null --
    the existing auto-sync in po_scraper.scraper will backfill po_no automatically once a real
    match appears). vessel_name is hardcoded "GCL YAMUNA" and title comes from the Excel in this
    fallback path, since there's no po_entries row to read them from.
  - Never creates a second row for a requisition_no/po_no combination already tracked. Two POs
    sharing one requisition_no (a legitimate split order) each still get their own row, same as
    po_scraper.scraper._sync_dd_tracker_entries already allows.

Usage (from backend/, venv activated):
  venv/bin/python backfill_gcya_dd_entries.py "DD - GCYA.xlsx"          # dry run
  venv/bin/python backfill_gcya_dd_entries.py "DD - GCYA.xlsx" --apply  # actually commit
"""
import re
import sys

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry

APPLY = "--apply" in sys.argv
EXCEL_PATH = next((a for a in sys.argv[1:] if not a.startswith("--")), "DD - GCYA.xlsx")


# A couple of PR Number cells carry a trailing human annotation, e.g.
# "GCYA/V-0148/REQ26 - created Direct PO" or "GCYA/V-0252/REQ26 - direct PO" -- keep only the
# actual requisition number, not the note.
_PR_NO_RE = re.compile(r"GCYA/[A-Z]-\d+/REQ\d+", re.IGNORECASE)


def clean_pr_no(raw: str | None) -> str | None:
    if not raw:
        return None
    m = _PR_NO_RE.search(raw)
    return m.group(0) if m else raw.strip()


def should_track(row) -> str | None:
    category = (row.get("Category") or "").strip().upper()
    if category == "DD":
        return "DD"
    if category == "OPEX":
        return "OPEX"
    title = (row.get("Title") or "").strip()
    if title.upper().startswith("DD"):
        return "DD"
    return None


wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
header = rows[0]
raw_rows = [dict(zip(header, r)) for r in rows[1:] if any(r)]

db = SessionLocal()
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}
tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}

to_create = []  # (entry_type, requisition_no, po_no, vessel_name, title)
queued_req_po = set()  # (req_no, po_no) pairs already queued this run, to avoid exact dupes

for row in raw_rows:
    entry_type = should_track(row)
    if not entry_type:
        continue

    po_no = (row.get("PO Number") or "").strip() or None
    pr_no = clean_pr_no(row.get("PR Number"))
    excel_title = (row.get("Title") or "").strip() or None

    po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first() if po_no else None

    if po:
        req_no = po.requisition_no or pr_no
        if po_no in tracked_po_nos or (req_no and req_no in tracked_req_nos):
            continue
        key = (req_no, po_no)
        if key in queued_req_po:
            continue
        queued_req_po.add(key)
        to_create.append((entry_type, req_no, po_no, po.vessel_name, po.title or excel_title))
    else:
        # No PO match (typo / not yet scraped / still PR-only) -- track by PR number alone.
        if not pr_no:
            continue  # truly nothing to key off of
        if pr_no in tracked_req_nos:
            continue
        key = (pr_no, None)
        if key in queued_req_po:
            continue
        queued_req_po.add(key)
        to_create.append((entry_type, pr_no, None, "GCL YAMUNA", excel_title))

print(f"{'=' * 70}\nTo create ({len(to_create)}){'  [DRY RUN -- nothing written]' if not APPLY else '  [APPLYING]'}\n{'=' * 70}")
for entry_type, req_no, po_no, vessel_name, title in to_create:
    print(f"[{entry_type:4s}] req={req_no or '—':22s} po={po_no or '—':18s} vessel={vessel_name:12s} {title}")
    if APPLY:
        db.add(DdTrackerEntry(
            entry_type=entry_type,
            requisition_no=req_no,
            po_no=po_no,
            vessel_name=vessel_name,
            title=title,
        ))

if APPLY:
    db.commit()
    print(f"\nCreated {len(to_create)} dd_tracker_entries row(s) and committed.")
else:
    print("\nDry run only -- re-run with --apply to actually create these rows.")

db.close()
