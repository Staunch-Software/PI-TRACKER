"""
One-off correction for a single mismatched vendor_code: the nightly vendor-list scrape stored
this vendor as vendor_code='Everllence' (its name, not SmartPAL's actual Code column), which is
why the detail-scrape Code filter always found 0 matching rows for it (see
check_bulk_scrape_results.py's 2026-11-04 investigation). Confirmed via email match
(Primeserv-Germany@everllence.com) against SmartPAL's real grid that this is vendor code
'Ever SE OZM' (not the similarly-named 'EVERGR', a different Danish branch).

vendor_code isn't a DB foreign key (just a shared text column across vendor_master_entries,
vendor_tracker_entries, vendor_bank_details, vendor_master_attachments), so every table needs the
same rename to stay consistent.

Usage (from backend/):
  python fix_everllence_vendor_code.py          # dry run (default)
  python fix_everllence_vendor_code.py --apply   # actually commit
"""
import sys

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.vendor_bank_detail import VendorBankDetail
from app.models.vendor_master_attachment import VendorMasterAttachment
from app.models.vendor_master_entry import VendorMasterEntry
from app.models.vendor_tracker_entry import VendorTrackerEntry

OLD_CODE = "Everllence"
NEW_CODE = "Ever SE OZM"
APPLY = "--apply" in sys.argv

db = SessionLocal()

master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == OLD_CODE).first()
if not master:
    print(f"No vendor_master_entries row with vendor_code={OLD_CODE!r} — nothing to do.")
    sys.exit(0)

existing_new = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == NEW_CODE).first()
if existing_new:
    print(f"A vendor_master_entries row with vendor_code={NEW_CODE!r} ALREADY EXISTS "
          f"({existing_new.vendor_name!r}) — aborting, this would collide.")
    sys.exit(1)

tracker_count = db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code == OLD_CODE).count()
bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == OLD_CODE).count()
attachment_count = db.query(VendorMasterAttachment).filter(VendorMasterAttachment.vendor_code == OLD_CODE).count()

print(f"vendor_master_entries: 1 row ({master.vendor_name!r}, {master.email!r})")
print(f"vendor_tracker_entries referencing {OLD_CODE!r}: {tracker_count}")
print(f"vendor_bank_details referencing {OLD_CODE!r}: {bank_count}")
print(f"vendor_master_attachments referencing {OLD_CODE!r}: {attachment_count}")
print(f"\nWould rename vendor_code {OLD_CODE!r} -> {NEW_CODE!r} across all of the above.")

if APPLY:
    master.vendor_code = NEW_CODE
    db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code == OLD_CODE).update({"vendor_code": NEW_CODE})
    db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == OLD_CODE).update({"vendor_code": NEW_CODE})
    db.query(VendorMasterAttachment).filter(VendorMasterAttachment.vendor_code == OLD_CODE).update({"vendor_code": NEW_CODE})
    db.commit()
    print("\nApplied.")
else:
    print("\nDry run only — re-run with --apply to actually write these changes.")
    db.rollback()

db.close()
