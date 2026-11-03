"""Read-only check: for every row in the GCYA DD/OPEX tracker Excel, is its PO present in
po_entries, and is it already tracked in dd_tracker_entries? A row is considered "should be
tracked" if Category is DD/OPEX, OR Category is blank but the title starts with "DD" (confirmed
with user 2026-11-03, same rule as the GCL TAPI fix).

Run from backend/, venv activated:
  venv/bin/python diagnose_gcya_excel.py "DD - GCYA.xlsx"
"""
import sys

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry

EXCEL_PATH = sys.argv[1] if len(sys.argv) > 1 else "DD - GCYA.xlsx"

wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
header = rows[0]
raw_rows = [dict(zip(header, r)) for r in rows[1:] if any(r)]


def should_track(row) -> str | None:
    """Returns the entry_type ('DD'/'OPEX') if this row should be tracked, else None."""
    category = (row.get("Category") or "").strip().upper()
    if category == "DD":
        return "DD"
    if category == "OPEX":
        return "OPEX"
    title = (row.get("Title") or "").strip()
    if title.upper().startswith("DD"):
        return "DD"
    return None


relevant = [(r, should_track(r)) for r in raw_rows]
relevant = [(r, et) for r, et in relevant if et]
print(f"Excel: {len(raw_rows)} total rows, {len(relevant)} considered DD/OPEX-relevant\n")

db = SessionLocal()
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}
tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}

no_po_number = []
missing_po_entry = []
already_tracked = []
to_backfill = []

for row, entry_type in relevant:
    po_no = (row.get("PO Number") or "").strip() or None
    pr_no = (row.get("PR Number") or "").strip() or None
    if not po_no:
        no_po_number.append(row)
        continue
    po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
    if not po:
        missing_po_entry.append((po_no, pr_no, row.get("Title")))
        continue
    if po_no in tracked_po_nos or (pr_no and pr_no in tracked_req_nos):
        already_tracked.append(po_no)
        continue
    to_backfill.append((po_no, pr_no, row.get("Title"), entry_type))

print(f"DD/OPEX-relevant rows with NO PO Number at all (PR-only / enquiry stage): {len(no_po_number)}")
for row in no_po_number:
    print(f"   PR={row.get('PR Number')!r}  title={row.get('Title')!r}")

print(f"\nPO Number present in Excel but NOT found in po_entries: {len(missing_po_entry)}")
for po_no, pr_no, title in missing_po_entry:
    print(f"   {po_no}  req={pr_no}  ({title})")

print(f"\nAlready tracked in dd_tracker_entries: {len(already_tracked)}")

print(f"\nTo backfill (found in po_entries, not yet tracked): {len(to_backfill)}")
for po_no, pr_no, title, entry_type in to_backfill:
    print(f"   [{entry_type}] {po_no}  req={pr_no}  ({title})")

db.close()
