"""
One-off backfill for po_entries.expected_delivery_date (migration 0048) — every PO already has
SmartPAL's "Scheduled Delivery Date" sitting unused in its own raw_json (scraped long before this
column existed), so this re-derives the column from data already on hand instead of waiting for
the next scheduled scrape (07:30/19:30) to populate it.

Usage (from backend/, venv activated):
  python backfill_po_expected_delivery_date.py          # dry run (default)
  python backfill_po_expected_delivery_date.py --apply   # actually commit
"""
import sys
from datetime import datetime

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.po_entry import PoEntry

APPLY = "--apply" in sys.argv


def parse_date(v):
    if not v:
        return None
    try:
        parsed = datetime.fromisoformat(str(v))
    except ValueError:
        return None
    if parsed.year <= 1:
        return None
    return parsed.date()


db = SessionLocal()

rows = db.query(PoEntry).filter(PoEntry.expected_delivery_date.is_(None)).all()
print(f"PO rows with no expected_delivery_date yet: {len(rows)}")

updated = 0
still_blank = 0
for po in rows:
    value = parse_date(po.raw_json.get("schd_Del_Date"))
    if value is None:
        still_blank += 1
        continue
    po.expected_delivery_date = value
    updated += 1

print(f"\n{'=' * 60}")
print(f"Would set expected_delivery_date on {updated} row(s) from their own raw_json.")
print(f"Still blank after this (SmartPAL itself has no value yet): {still_blank}")
print(f"{'=' * 60}")

if APPLY:
    db.commit()
    print(f"\nApplied — committed {updated} update(s).")
else:
    print("\nDry run only — re-run with --apply to actually write these changes.")
    db.rollback()

db.close()
