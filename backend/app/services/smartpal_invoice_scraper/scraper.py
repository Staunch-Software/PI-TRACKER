# ===========================================================================
# backend/app/services/smartpal_invoice_scraper/scraper.py
#
# Scrapes SmartPAL's Purchase > Transactions > Invoice Approval page
# (PurchasePALApp/Purchase/InvoiceList) — but unlike approved_invoice_scraper (which only reads
# the "Finally Approved" tab for the 4 AMNS-fleet vessels), this reads the "All" tab: confirmed
# live (2026-09-22) it returns EVERY invoice across EVERY vessel and EVERY status (Pending,
# Approved, Finally Approved, Disputed, Cancelled, Rejected — confirmed live tab labels) in one
# grid, each row carrying its own `status` field. So one sweep of "All" covers every status
# without needing to click through each status tab separately.
#
# This table (smartpal_invoice_entries) is the 1st-priority SOA reconciliation match source (see
# that model's docstring / soa_scraper/matching.py) — the point is to know an invoice's REAL
# current SmartPAL state, whatever vessel/vendor it belongs to, not just the AMNS Finally
# Approved subset approved_invoice_entries tracks for its own (unrelated) Paid/Not-Paid workflow.
#
# Shares the login session/auth.json with approved_invoice_scraper (same URL, same account —
# see APPROVED_INVOICE_AUTH_JSON) and reuses its generic Kendo-grid-paging helpers
# (_capture_next_grid_response/_advance_and_capture are pure functions with no AMNS-specific
# behavior) rather than duplicating ~40 lines of pagination logic that would otherwise drift.
# ===========================================================================
import json
import logging
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from app.core.config import APPROVED_INVOICE_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.models.vessel import Vessel
from app.services.approved_invoice_scraper.generate_auth import run_automated_login
from app.services.approved_invoice_scraper.scraper import _advance_and_capture, _capture_next_grid_response
from app.services.pir_vessel_matcher import normalize_vessel_name
from app.services.soa_scraper.normalize import normalize_invoice_number

log = logging.getLogger(__name__)

_ALL_TAB_LABEL = "All"


def _num(v) -> Decimal | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_date(v: str | None) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.split("T")[0]).date()
    except ValueError:
        return None


def _select_all_tab(page) -> None:
    """[SELECTOR] Same plain-clickable-text pattern as approved_invoice_scraper's tab
    selection, confirmed live 2026-09-22."""
    tab = page.locator(f"*:text-is('{_ALL_TAB_LABEL}')").first
    try:
        tab.click(timeout=10000)
    except PlaywrightTimeoutError:
        page.locator(f"text={_ALL_TAB_LABEL}").first.click(timeout=10000, force=True)
    page.wait_for_timeout(1000)


def _extract_rows(page) -> list[dict]:
    all_rows: list[dict] = []

    # Diagnostic added 2026-11-23: the live SmartPAL UI's Invoice List page shows its own
    # From/To Date and Category filter widgets, separate from the status tabs — this scraper has
    # never touched either, just clicking "All" and trusting whatever filter state the page
    # happens to have (fresh login's own default, not necessarily "every invoice ever"). Confirmed
    # with the user 2026-11-23: a fresh scrape's own captured total_count (2371) came in far below
    # SmartPAL's own live "All" tab count (3966) — logging the exact request body used here will
    # show whether a narrower date range or category filter is silently in effect.
    captured_body: dict = {}

    def _on_request(req):
        if req.method == "POST" and "ServiceRouter" in req.url and req.post_data and "gridServerOperations" in req.post_data:
            try:
                captured_body["body"] = json.loads(req.post_data)
            except json.JSONDecodeError:
                pass

    page.on("request", _on_request)
    first_page_rows = _capture_next_grid_response(page, lambda: _select_all_tab(page))
    page.remove_listener("request", _on_request)
    if captured_body.get("body"):
        filter_keys = {k: v for k, v in captured_body["body"].items() if k != "gridServerOperations"}
        log.info(f"[GRID]     Captured request filter fields: {filter_keys}")

    all_rows.extend(first_page_rows)
    total_count = first_page_rows[0]["totalCount"] if first_page_rows else 0
    log.info(f"[GRID]     All: {total_count} total invoice(s) across every vessel/status, page 1 → {len(first_page_rows)} row(s).")

    page_num = 1
    while len(all_rows) < total_count:
        page_rows = _advance_and_capture(page)
        if page_rows is None:
            log.warning(
                f"[GRID]     Pager 'next' unavailable/disabled after {len(all_rows)}/{total_count} rows collected — "
                "stopping here rather than looping forever."
            )
            break
        all_rows.extend(page_rows)
        page_num += 1
        log.info(f"[GRID]     Page {page_num} → {len(page_rows)} row(s) ({len(all_rows)}/{total_count} total so far).")

    return all_rows


def run() -> None:
    log.info("=" * 60)
    log.info("  SmartPAL Invoice (all statuses/vessels) scrape — starting")
    log.info("=" * 60)

    # Same short-session stance as approved_invoice_scraper — always regenerate rather than
    # assume a saved auth.json is still good.
    run_automated_login()

    db = SessionLocal()
    total_inserted = total_updated = total_errors = 0

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=settings.mariapps_headless)
            context = browser.new_context(storage_state=str(APPROVED_INVOICE_AUTH_JSON))
            page = context.new_page()

            log.info(f"[NAV]      Navigating to: {settings.approved_invoice_list_url}")
            page.goto(settings.approved_invoice_list_url, wait_until="load", timeout=60000)

            if "Account/Index" in page.url or "Sign in" in page.title():
                log.error("[NAV]      Session did not stick — landed back on the login page. Aborting.")
                browser.close()
                db.close()
                return

            page.wait_for_timeout(2000)
            rows = _extract_rows(page)

            # A genuine 0-row result across every vessel/status is practically impossible for
            # this fleet (thousands of invoices exist) — confirmed live 2026-11-22: a run can
            # silently report "0 total invoice(s)" with no error at all (the "All" tab click
            # apparently raced the page still loading, same class of timing issue as the vendor
            # attachments popup elsewhere in this codebase), which previously left every
            # existing row's status stale with zero visibility that anything went wrong. Reload
            # and retry the whole capture once before giving up, rather than trusting a bare 0.
            if not rows:
                log.warning(
                    "[GRID]     0 invoice rows returned — almost certainly a page-load race, not "
                    "reality. Reloading and retrying the capture once."
                )
                page.reload(wait_until="load", timeout=60000)
                page.wait_for_timeout(3000)
                rows = _extract_rows(page)

            browser.close()

        if not rows:
            log.error(
                "[GRID]     Still 0 invoice rows after retry — aborting without touching existing "
                "data. This is a scrape failure, not reality; investigate rather than re-running "
                "blindly (existing smartpal_invoice_entries rows are untouched and may now be stale)."
            )
            return

        log.info(f"[GRID]     {len(rows)} total invoice row(s) fetched (all vessels, all statuses).")

        # Exact normalized match only (same conservative stance as SOA ingest's vessel
        # resolution) — no substring/fuzzy guessing here, since a wrong match would corrupt the
        # SOA reconciliation match source. Rows with no confident match keep vessel_id NULL.
        vessel_cache = {normalize_vessel_name(name): vid for name, vid in db.query(Vessel.name, Vessel.id).all()}

        for row in rows:
            smartpal_id = row.get("id")
            if smartpal_id is None:
                total_errors += 1
                continue

            try:
                invoice_no = row.get("invoiceNo")
                vessel_name = (row.get("vesselName") or "").strip() or None
                values = {
                    "invoice_no": invoice_no,
                    "invoice_no_normalized": normalize_invoice_number(invoice_no) if invoice_no else None,
                    "vendor_invoice_no": row.get("vendorInvoiceNo"),
                    "vendor_name": (row.get("vendorName") or "").strip() or None,
                    "vessel_name": vessel_name,
                    "vessel_id": vessel_cache.get(normalize_vessel_name(vessel_name)) if vessel_name else None,
                    "amount": _num(row.get("invoiceAmount")),
                    "currency_code": row.get("invoiceCurrency"),
                    "invoice_date": _parse_date(row.get("invDate")),
                    "status": row.get("status"),
                    "paid_status": row.get("paidStatus"),
                    "po_nos": row.get("poNos"),
                    "category_name": row.get("categoryName"),
                    "raw_json": row,
                }

                existing = db.query(SmartpalInvoiceEntry).filter(
                    SmartpalInvoiceEntry.smartpal_invoice_id == smartpal_id
                ).first()
                if existing:
                    for field, value in values.items():
                        setattr(existing, field, value)
                    total_updated += 1
                else:
                    db.add(SmartpalInvoiceEntry(smartpal_invoice_id=smartpal_id, **values))
                    total_inserted += 1
                db.commit()
            except Exception as e:
                db.rollback()
                total_errors += 1
                log.error(f"[SAVE]     Failed to upsert invoice id={smartpal_id}: {e}")
    finally:
        db.close()

    log.info("=" * 60)
    log.info(f"  SmartPAL Invoice scrape complete — inserted={total_inserted} updated={total_updated} errors={total_errors}")
    log.info("=" * 60)

    # Freshly-scraped SmartPAL data can flip a SOA line item's match result (e.g. an invoice
    # that was previously "No Match" now exists here) — refresh immediately rather than waiting
    # for the next SOA mail poll or a manual "Rematch Now" click.
    from app.services.soa_scraper.matching import rematch_all_current_line_items

    db = SessionLocal()
    try:
        log.info("Running SOA match pass...")
        rematch_all_current_line_items(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
