"""Diagnose why DD-category GCL TAPI POs aren't auto-tracked in dd_tracker_entries.
Read-only. Run from backend/, venv activated:
  venv/bin/python diagnose_untracked_tapi_dd_pos.py "GCL TAPI - DD - Order Status.xlsx"
"""
import sys

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.services.po_scraper.scraper import _is_dd_category

EXCEL_PATH = sys.argv[1] if len(sys.argv) > 1 else "GCL TAPI - DD - Order Status.xlsx"

wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["rptPOOverview"]
rows = list(ws.iter_rows(min_row=3, max_row=ws.max_row, values_only=True))
po_nos = [r[2] for r in rows if r[2]]

db = SessionLocal()
tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}
tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}

untracked = [p for p in po_nos if p not in tracked_po_nos]
print(f"{len(untracked)} PO(s) not tracked -- diagnosing each:\n")

reasons = {}
for po_no in untracked:
    po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
    if not po:
        reasons.setdefault("PO row missing entirely", []).append(po_no)
        continue

    if po.requisition_no:
        if po.requisition_no in tracked_req_nos:
            reasons.setdefault("requisition_no IS tracked (po_no just never got linked)", []).append(po_no)
            continue
        pr = db.query(PrEntry).filter(PrEntry.requisition_no == po.requisition_no).first()
        if not pr:
            reasons.setdefault("has requisition_no, but NO matching pr_entries row", []).append(
                f"{po_no} (req={po.requisition_no})"
            )
        elif not pr.req_category:
            reasons.setdefault("PR exists but req_category is NULL", []).append(
                f"{po_no} (req={po.requisition_no}, pr.status={pr.status!r})"
            )
        elif not _is_dd_category(pr.req_category):
            reasons.setdefault("PR exists, has a category, but _is_dd_category() says NO", []).append(
                f"{po_no} (req={po.requisition_no}, pr.req_category={pr.req_category!r})"
            )
        else:
            reasons.setdefault("PR looks DD and should have synced -- unexplained", []).append(
                f"{po_no} (req={po.requisition_no}, pr.req_category={pr.req_category!r})"
            )
    else:
        # Direct PO path (no requisition_no) -- should go through the PO-driven branch instead.
        if not po.req_category:
            reasons.setdefault("Direct PO (no requisition_no), but po.req_category is NULL", []).append(po_no)
        elif not _is_dd_category(po.req_category):
            reasons.setdefault("Direct PO, has a category, but _is_dd_category() says NO", []).append(
                f"{po_no} (po.req_category={po.req_category!r})"
            )
        else:
            reasons.setdefault("Direct PO looks DD and should have synced -- unexplained", []).append(
                f"{po_no} (po.req_category={po.req_category!r})"
            )

for reason, items in reasons.items():
    print(f"=== {reason} ({len(items)}) ===")
    for item in items:
        print(f"   {item}")
    print()

db.close()
