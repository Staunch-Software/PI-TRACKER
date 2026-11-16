"""
Read-only diagnostic for a "Scrape All Vendor Details" bulk run (vendor_detail_bulk_scrape_runs /
run_bulk_detail_scrape in services/vendor_master_scraper/detail_scraper.py).

The run row itself only has aggregate counts (succeeded/failed) — it never records WHICH vendor
failed or WHY, so this reconstructs that:
  - "failed" here = vendor_master_entries rows still missing detail_scraped_at (same check
    run_bulk_detail_scrape itself uses to decide success vs failure per vendor).
  - For a "succeeded" vendor, scrape_vendor_detail() is best-effort per sub-step (contacts/bank
    tab/attachments each log a warning and move on rather than failing the whole vendor) — so
    "succeeded" only means the vendor page opened and detail_scraped_at got stamped, NOT that
    every sub-step necessarily captured data. The zero-bank-row / zero-attachment counts below are
    a sanity flag for that, not proof of a problem (plenty of real vendors have no bank details or
    attachments on file).

The actual error message for any failure only ever went to the backend's log output (log.warning/
log.error calls in detail_scraper.py), never the DB — see the printed journalctl command at the
end to pull those for the vendor codes listed below.

Usage (from backend/, no --apply flag, this never writes anything):
  python check_bulk_scrape_results.py
"""
import sys

sys.path.insert(0, ".")
from app.db.session import SessionLocal
from app.models.vendor_bank_detail import VendorBankDetail
from app.models.vendor_detail_bulk_scrape_run import VendorDetailBulkScrapeRun
from app.models.vendor_master_attachment import VendorMasterAttachment
from app.models.vendor_master_entry import VendorMasterEntry

db = SessionLocal()

run = db.query(VendorDetailBulkScrapeRun).order_by(VendorDetailBulkScrapeRun.started_at.desc()).first()
if not run:
    print("No bulk scrape run found.")
    sys.exit(0)

print("=" * 70)
print(f"Run {run.id}")
print(f"  status:       {run.status}")
print(f"  started_at:   {run.started_at}")
print(f"  finished_at:  {run.finished_at}")
print(f"  total:        {run.total}")
print(f"  completed:    {run.completed}")
print(f"  succeeded:    {run.succeeded}")
print(f"  failed:       {run.failed}")
print(f"  current:      {run.current_vendor_code}")
print("=" * 70)

still_unscraped = (
    db.query(VendorMasterEntry.vendor_code, VendorMasterEntry.vendor_name)
    .filter(VendorMasterEntry.detail_scraped_at.is_(None))
    .order_by(VendorMasterEntry.vendor_code)
    .all()
)
print(f"\nVendors still with NO detail_scraped_at (these are the ones that failed): {len(still_unscraped)}")
for code, name in still_unscraped:
    print(f"  {code}\t{name}")

scraped = (
    db.query(VendorMasterEntry.vendor_code, VendorMasterEntry.vendor_name)
    .filter(VendorMasterEntry.detail_scraped_at.is_not(None))
    .all()
)
scraped_codes = [c for c, _ in scraped]
print(f"\nVendors successfully detail-scraped: {len(scraped_codes)}")

from sqlalchemy import func
bank_rows = dict(
    db.query(VendorBankDetail.vendor_code, func.count(VendorBankDetail.id))
    .filter(VendorBankDetail.vendor_code.in_(scraped_codes))
    .group_by(VendorBankDetail.vendor_code)
    .all()
) if scraped_codes else {}
attachment_rows = dict(
    db.query(VendorMasterAttachment.vendor_code, func.count(VendorMasterAttachment.id))
    .filter(VendorMasterAttachment.vendor_code.in_(scraped_codes))
    .group_by(VendorMasterAttachment.vendor_code)
    .all()
) if scraped_codes else {}

zero_bank = [c for c in scraped_codes if bank_rows.get(c, 0) == 0]
zero_attachment = [c for c in scraped_codes if attachment_rows.get(c, 0) == 0]
print(f"\nOf the scraped vendors, {len(zero_bank)} have 0 bank rows and {len(zero_attachment)} have 0 attachments.")
print("(Not necessarily wrong — many real vendors have neither on file — but worth a spot check")
print(" if these numbers look high relative to your fleet's expectations.)")

if still_unscraped:
    codes = " -e ".join(c for c, _ in still_unscraped)
    print("\nTo see WHY each of the above failed, pull the backend log around the run window, e.g.:")
    print(f'  sudo journalctl -u pi_tracker --since "{run.started_at}" | grep -E "VENDOR|{codes}"')

db.close()
