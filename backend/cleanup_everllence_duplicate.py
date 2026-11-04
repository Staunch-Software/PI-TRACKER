"""
One-off cleanup for the Everllence duplicate vendor (see fix_everllence_vendor_code.py's
investigation, 2026-11-04): this vendor exists TWICE in vendor_master_entries —

  - vendor_code='Everllence'   (the vendor's NAME was mistakenly captured as its code at some
    point before SmartPAL's Code filter — and hence detail-scraping — could ever find it) — has
    its own vendor_tracker_entries row too, but was NEVER successfully detail-scraped.
  - vendor_code='Ever SE OZM'  (the real SmartPAL code, confirmed via matching email
    Primeserv-Germany@everllence.com) — already successfully detail-scraped, already has its own
    separate vendor_tracker_entries row.

Both tracker rows have is_dd_vendor=True, so this vendor is currently showing up TWICE in the
Vendor Management / DD Vendors list. Since the correct one ('Ever SE OZM') is already fully
scraped and tracked, this just removes the stale 'Everllence' duplicate (master entry + its
tracker entry — vendor_bank_attachments cascade-deletes with the tracker entry via its own FK).

Does NOT touch 'Ever SE OZM' at all.

Usage (from backend/):
  python cleanup_everllence_duplicate.py          # dry run (default)
  python cleanup_everllence_duplicate.py --apply   # actually commit
"""
import sys

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.vendor_master_entry import VendorMasterEntry
from app.models.vendor_tracker_entry import VendorTrackerEntry

STALE_CODE = "Everllence"
APPLY = "--apply" in sys.argv

db = SessionLocal()

master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == STALE_CODE).first()
tracker = db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code == STALE_CODE).first()

if not master and not tracker:
    print(f"Nothing found for vendor_code={STALE_CODE!r} — already cleaned up, or never existed.")
    sys.exit(0)

print(f"vendor_master_entries row: {(master.vendor_name, master.email) if master else None}")
if tracker:
    print(
        f"vendor_tracker_entries row: id={tracker.id}, is_dd_vendor={tracker.is_dd_vendor}, "
        f"bank_details_status={tracker.bank_details_status!r}, "
        f"bank_verification_completed={tracker.bank_verification_completed}"
    )
    if tracker.bank_details_status != "missing" or tracker.bank_verification_completed:
        print(
            "\n*** WARNING: this tracker row has non-default workflow state (a bank request was "
            "sent/received/verified against the WRONG code) — double check before deleting, this "
            "history would be lost. ***"
        )
else:
    print("vendor_tracker_entries row: none")

print(f"\nWould delete the above (master row + tracker row for {STALE_CODE!r} only).")

if APPLY:
    if tracker:
        db.delete(tracker)
    if master:
        db.delete(master)
    db.commit()
    print("\nApplied — deleted.")
else:
    print("\nDry run only — re-run with --apply to actually delete these rows.")
    db.rollback()

db.close()
