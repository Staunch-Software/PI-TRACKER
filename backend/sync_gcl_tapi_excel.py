"""
Sync GCL TAPI DD Order Status Excel into DD Tracker.

Mapping rules (confirmed with user 2026-11-03):
  - Excel "Invoice Status" == "Advance payment"  -> Invoice Type = "Proforma Invoice"
  - Excel "Readiness Date / Lead time" column, by pattern:
      "<N> days"            -> Readiness Date = PO's approved_date + N days
                                 (Lead Days is never stored directly -- it's always computed
                                 live as Readiness Date - PO Approved Date, so this alone makes
                                 Lead Days show N automatically)
      "In stock"            -> Ex-Stock = "In Stock"
      "Ready by <D> - <Mon>"-> Readiness Date = that explicit date (year 2026)
      "Awaiting readiness" / "Order ready" / "Service" / "In warehouse"
                            -> Order Status = the exact text (trimmed)
  - Excel "Schd.Delivery Port" -> Supply Port
  - Excel "Remarks"            -> Remarks
  - FILL-BLANK-ONLY: never overwrites a field that already has a value in dd_tracker_entries.

Usage (from backend/, venv activated):
  python sync_gcl_tapi_excel.py "GCL TAPI - DD - Order Status.xlsx"          # dry run (default)
  python sync_gcl_tapi_excel.py "GCL TAPI - DD - Order Status.xlsx" --apply  # actually commit
"""
import re
import sys
from datetime import date, timedelta

import openpyxl

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry

APPLY = "--apply" in sys.argv
EXCEL_PATH = next((a for a in sys.argv[1:] if not a.startswith("--")), "GCL TAPI - DD - Order Status.xlsx")

_DAYS_RE = re.compile(r"(\d+)\s*days?", re.IGNORECASE)
_READY_BY_RE = re.compile(r"ready\s+by\s+(\d{1,2})\s*-\s*([A-Za-z]{3,})", re.IGNORECASE)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_ORDER_STATUS_VALUES = {"awaiting readiness", "order ready", "service", "in warehouse"}


def classify_readiness(raw: str | None) -> tuple[str, object] | None:
    """Returns (field, value) where field is one of
    'readiness_date_days' (value=N, needs + approved_date), 'readiness_date_explicit'
    (value=date), 'ex_stock' (value=str), 'order_status' (value=str) -- or None if blank/unknown."""
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None

    m = _READY_BY_RE.search(text)
    if m:
        day = int(m.group(1))
        mon = _MONTHS.get(m.group(2).lower()[:3])
        if mon:
            return ("readiness_date_explicit", date(2026, mon, day))

    m = _DAYS_RE.search(text)
    if m:
        return ("readiness_date_days", int(m.group(1)))

    if text.lower() == "in stock" or text.lower() == "in stock ":
        return ("ex_stock", "In Stock")
    if "in stock" in text.lower():
        return ("ex_stock", "In Stock")

    if text.lower() in _ORDER_STATUS_VALUES:
        return ("order_status", text)

    return ("unknown", text)


wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb["rptPOOverview"]
rows = list(ws.iter_rows(min_row=3, max_row=ws.max_row, values_only=True))

excel_rows = []
for r in rows:
    po_no = r[2]
    if not po_no:
        continue
    excel_rows.append({
        "po_no": po_no,
        "requisition_no": r[13],
        "title": r[3],
        "invoice_status": r[8],
        "schd_delivery_port": r[11],
        "readiness_raw": r[12],
        "remarks": r[15],
    })

print(f"Excel: {len(excel_rows)} PO rows\n{'=' * 70}")

db = SessionLocal()

missing_po = []
po_no_dd_entry = []
unknown_readiness = []
changes = []  # (dd_entry, field, old, new, po_no)

for row in excel_rows:
    po = db.query(PoEntry).filter(PoEntry.po_no == row["po_no"]).first()
    if not po:
        missing_po.append(row)
        continue
    dd_entry = db.query(DdTrackerEntry).filter(DdTrackerEntry.po_no == row["po_no"]).first()
    if not dd_entry:
        po_no_dd_entry.append(row)
        continue

    def propose(field, new_value):
        old_value = getattr(dd_entry, field)
        if old_value:  # fill-blank-only
            return
        if new_value is None or new_value == "":
            return
        changes.append((dd_entry, field, old_value, new_value, row["po_no"]))

    # Invoice Type <- Invoice Status == "Advance payment"
    if (row["invoice_status"] or "").strip().lower() == "advance payment":
        propose("invoice_type", "Proforma Invoice")

    # Supply Port <- Schd. Delivery Port
    sdp = (row["schd_delivery_port"] or "").strip()
    if sdp and sdp.lower() != "unknown":
        propose("supply_port", sdp)

    # Remarks <- Remarks
    remarks = (row["remarks"] or "").strip()
    if remarks:
        propose("remarks", remarks)

    # Readiness Date / Lead time -> one of 3 buckets
    classification = classify_readiness(row["readiness_raw"])
    if classification:
        field, value = classification
        if field == "readiness_date_days":
            if po.approved_date:
                propose("readiness_date", po.approved_date + timedelta(days=value))
            else:
                unknown_readiness.append((row["po_no"], row["readiness_raw"], "no po.approved_date to compute from"))
        elif field == "readiness_date_explicit":
            propose("readiness_date", value)
        elif field == "ex_stock":
            propose("ex_stock", value)
        elif field == "order_status":
            propose("order_status", value)
        else:
            unknown_readiness.append((row["po_no"], row["readiness_raw"], "did not match any known pattern"))

print(f"\nPresent in po_entries: {len(excel_rows) - len(missing_po)} / {len(excel_rows)}")
print(f"NOT found in po_entries at all: {len(missing_po)}")
for row in missing_po:
    print(f"   {row['po_no']}  req={row['requisition_no']}  ({row['title']})")

print(f"\nFound in po_entries but NOT tracked in dd_tracker_entries: {len(po_no_dd_entry)}")
for row in po_no_dd_entry:
    print(f"   {row['po_no']}  ({row['title']})")

print(f"\nReadiness text that didn't match any known pattern: {len(unknown_readiness)}")
for po_no, raw, reason in unknown_readiness:
    print(f"   {po_no}  raw={raw!r}  -- {reason}")

print(f"\n{'=' * 70}\nPROPOSED CHANGES ({len(changes)}){'  [DRY RUN -- nothing written]' if not APPLY else '  [APPLYING]'}\n{'=' * 70}")
for dd_entry, field, old, new, po_no in changes:
    print(f"{po_no:20s} {field:16s}  {old!r:>12} -> {new!r}")

if APPLY:
    for dd_entry, field, old, new, po_no in changes:
        setattr(dd_entry, field, new)
    db.commit()
    print(f"\nApplied {len(changes)} change(s) and committed.")
else:
    print("\nDry run only -- re-run with --apply to actually write these changes.")

db.close()
