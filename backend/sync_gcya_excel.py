"""Sync GCL Yamuna DD/OPEX tracker Excel field values into DD Tracker.

Mapping rules confirmed with user 2026-11-03:
  - Title            -> title (team's own current label)
  - Category (or title-inferred DD) -> entry_type
  - Order status      -> order_status            (direct text copy)
  - Readiness date    -> readiness_date           (real dates only; "NA"/blank left untouched)
  - Supply port       -> supply_port
  - Remakrs           -> remarks
  - Supply status     -> supply_confirmation (the "Delivery Status" field)
  - Invoice type      -> invoice_type (only when it's exactly "Proforma Invoice"/"Tax Invoice")

OVERWRITE policy (per user, since this Excel is the team's actively-maintained sheet): when the
Excel has a non-blank value for a field, it replaces whatever is currently in DD Tracker. A BLANK
Excel cell never clears an existing value -- it's simply left untouched (sync, not erase).

Matches rows the same way backfill_gcya_dd_entries.py does: by po_no when the Excel's PO Number
is a real po_entries row, else by PR Number (cleaned of trailing annotations).

Usage (from backend/, venv activated):
  venv/bin/python sync_gcya_excel.py "DD - GCYA.xlsx"          # dry run
  venv/bin/python sync_gcya_excel.py "DD - GCYA.xlsx" --apply  # actually commit
"""
import re
import sys
from datetime import date, datetime

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry

APPLY = "--apply" in sys.argv
EXCEL_PATH = next((a for a in sys.argv[1:] if not a.startswith("--")), "DD - GCYA.xlsx")

_PR_NO_RE = re.compile(r"GCYA/[A-Z]-\d+/REQ\d+", re.IGNORECASE)


def clean_pr_no(raw) -> str | None:
    if not raw:
        return None
    raw = str(raw)
    m = _PR_NO_RE.search(raw)
    return m.group(0) if m else raw.strip()


def classify_entry_type(row) -> str | None:
    category = (row.get("Category") or "").strip().upper()
    if category == "DD":
        return "DD"
    if category == "OPEX":
        return "OPEX"
    title = (row.get("Title") or "").strip()
    if title.upper().startswith("DD"):
        return "DD"
    return None


def parse_readiness_date(raw) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    text = str(raw).strip()
    if not text or text.upper() == "NA":
        return None
    return None  # anything else unparseable -- skip rather than guess


wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
header = rows[0]
raw_rows = [dict(zip(header, r)) for r in rows[1:] if any(r)]

db = SessionLocal()

changes = []  # (entry, field, old, new, label)
unmatched = []
unparseable_dates = []

for row in raw_rows:
    entry_type = classify_entry_type(row)
    if not entry_type:
        continue

    po_no = (row.get("PO Number") or "").strip() or None
    pr_no = clean_pr_no(row.get("PR Number"))

    entry = None
    if po_no:
        po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
        if po:
            entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.po_no == po_no).first()
            if not entry and po.requisition_no:
                entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.requisition_no == po.requisition_no).first()
    if not entry and pr_no:
        entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.requisition_no == pr_no).first()

    if not entry:
        unmatched.append((po_no, pr_no, row.get("Title")))
        continue

    label = po_no or pr_no or "?"

    def propose(field, new_value):
        if new_value is None or new_value == "":
            return
        old_value = getattr(entry, field)
        if old_value == new_value:
            return
        changes.append((entry, field, old_value, new_value, label))

    propose("entry_type", entry_type)
    propose("title", (row.get("Title") or "").strip() or None)
    propose("order_status", (row.get("Order status") or "").strip() or None)
    propose("supply_port", (row.get("Supply port") or "").strip() or None)
    propose("remarks", (row.get("Remakrs") or "").strip() or None)
    propose("supply_confirmation", (row.get("Supply status") or "").strip() or None)

    inv_type = (row.get("Invoice type") or "").strip()
    if inv_type in ("Proforma Invoice", "Tax Invoice"):
        propose("invoice_type", inv_type)

    raw_readiness = row.get("Readiness date")
    readiness = parse_readiness_date(raw_readiness)
    if readiness:
        propose("readiness_date", readiness)
    elif raw_readiness and str(raw_readiness).strip().upper() != "NA":
        unparseable_dates.append((label, raw_readiness))

print(f"Excel: {len(raw_rows)} total rows")
print(f"\nDD/OPEX-relevant rows with no matching dd_tracker_entries row (not yet backfilled?): {len(unmatched)}")
for po_no, pr_no, title in unmatched:
    print(f"   po={po_no!r} req={pr_no!r}  ({title})")

print(f"\nReadiness date values that didn't parse (not 'NA', not a real date): {len(unparseable_dates)}")
for label, raw in unparseable_dates:
    print(f"   {label}  raw={raw!r}")

print(f"\n{'=' * 70}\nPROPOSED CHANGES ({len(changes)}){'  [DRY RUN -- nothing written]' if not APPLY else '  [APPLYING]'}\n{'=' * 70}")
for entry, field, old, new, label in changes:
    print(f"{label:20s} {field:20s}  {old!r:>20} -> {new!r}")

if APPLY:
    for entry, field, old, new, label in changes:
        setattr(entry, field, new)
    db.commit()
    print(f"\nApplied {len(changes)} change(s) and committed.")
else:
    print("\nDry run only -- re-run with --apply to actually write these changes.")

db.close()
