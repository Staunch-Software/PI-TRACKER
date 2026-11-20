# ===========================================================================
# backend/app/services/po_scraper/backfill_2025.py
#
# ONE-TIME historical backfill — pulls PR/PO rows SmartPAL has from 2025-07-01 up to (but not
# including) scraper.py's own FROM_DATE (2026-07-01), confirmed with the user 2026-11-20. This is
# deliberately a separate script rather than a permanent change to FROM_DATE itself: widening
# FROM_DATE would make the twice-daily scrape re-request the full 2025-07-01-onward range on every
# future run, forever, for no benefit once this one-off gap is filled.
#
# Run manually, once, from backend/:
#   .venv\Scripts\python.exe -m app.services.po_scraper.backfill_2025
#
# Safe to re-run if interrupted — _run_pr/_run_po upsert by requisition_no/po_no, same as the
# regular scraper, so there's no duplicate-row risk from running this more than once.
# ===========================================================================
import logging
from datetime import date

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.services.pir_scraper.generate_auth import run_automated_login
from app.services.po_scraper.scraper import (
    FROM_DATE,
    _run_pr,
    _run_po,
    _sync_dd_tracker_entries,
    scrape_dd_po_items,
)

log = logging.getLogger(__name__)

BACKFILL_FROM_DATE = date(2025, 7, 1)
BACKFILL_TO_DATE = date(2026, 6, 30)  # day before FROM_DATE — the regular scraper already owns 2026-07-01 onward


def run_backfill() -> None:
    if not MARIAPPS_AUTH_JSON.exists():
        log.info("[AUTH]     No saved session found — running automated login first.")
        run_automated_login()

    db = SessionLocal()
    pr_counters = po_counters = dd_sync_counters = None
    try:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                pr_counters = _run_pr(context.new_page(), db, from_date=BACKFILL_FROM_DATE, to_date=BACKFILL_TO_DATE)
                po_counters = _run_po(context.new_page(), db, from_date=BACKFILL_FROM_DATE, to_date=BACKFILL_TO_DATE)
                browser.close()
        except RuntimeError as e:
            if "expired" not in str(e).lower() and "not authenticated" not in str(e).lower():
                raise
            log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
            run_automated_login()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                pr_counters = _run_pr(context.new_page(), db, from_date=BACKFILL_FROM_DATE, to_date=BACKFILL_TO_DATE)
                po_counters = _run_po(context.new_page(), db, from_date=BACKFILL_FROM_DATE, to_date=BACKFILL_TO_DATE)
                browser.close()

        # Same tail as the regular scraper's run() — any DD/PD-flavored PR/PO just backfilled
        # should get tracked and have its PO items pulled in, same as a normal scrape.
        dd_sync_counters = _sync_dd_tracker_entries(db)
    finally:
        db.close()

    po_items_counters = {}
    try:
        po_items_counters = scrape_dd_po_items()
    except Exception as e:
        log.error(f"[PO ITEMS] Backfill PO items scrape encountered error: {e}")
        po_items_counters = {"error": str(e)}

    log.info("=" * 60)
    log.info(f"  Backfill range: {BACKFILL_FROM_DATE} to {BACKFILL_TO_DATE} (regular scraper owns {FROM_DATE} onward)")
    log.info(f"  PR backfill complete — {pr_counters}")
    log.info(f"  PO backfill complete — {po_counters}")
    log.info(f"  DD/PD Tracker auto-sync complete — {dd_sync_counters}")
    log.info(f"  PO Items scrape complete — {po_items_counters}")
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run_backfill()
