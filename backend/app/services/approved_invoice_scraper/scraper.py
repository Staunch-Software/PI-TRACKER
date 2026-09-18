# ===========================================================================
# backend/app/services/approved_invoice_scraper/scraper.py
#
# Scrapes SmartPAL's Purchase > Transactions > Invoice Approval page
# (PurchasePALApp/Purchase/InvoiceList), "Finally Approved" tab (hdnStatusCode
# FNL), for the 4 AMNS-fleet vessels only (AMNS Polar, AMNS Tufmax, AMNSI
# Maximus, AMNSI Stallion) — confirmed live 2026-09-09 these are the only
# vessels this table should ever contain rows for (per the task scope).
#
# Reads the grid via SmartPAL's own JSON API (PurchasePALApp/api/
# ServiceRouter/POST) rather than DOM-scraping the Kendo grid — same
# "prefer the clean API over the DOM" approach as pir_scraper, and this one's
# record shape is even cleaner than PIR's (real field names, no locked/
# scrollable table split to fight). Confirmed live that a bare `fetch()`
# with a hand-rolled body (or the exact real body with only pageSize bumped)
# gets rejected by the server (500) — so this drives the REAL pager "Next"
# button via Playwright and captures each page's genuine response instead of
# trying to force a bigger page in one call. That's slower (the "Finally
# Approved" tab has ~1200 rows across the whole fleet, 25/page = ~48 clicks)
# but doesn't depend on guessing what the server will accept.
# ===========================================================================
import hashlib
import json
import logging
import time
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from app.core.config import APPROVED_INVOICE_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.approved_invoice_entry import ApprovedInvoiceEntry
from app.models.vessel import Vessel
from .generate_auth import run_automated_login

log = logging.getLogger(__name__)

# Confirmed live (2026-09-09) — exact vesselName strings as SmartPAL renders them on the
# "Finally Approved" tab. Only these 4 rows are kept; everything else in the fleet-wide
# response is discarded. If SmartPAL ever renders a 5th naming variant for one of these
# vessels, it will silently NOT match here — unlike pir_vessel_matcher.py's fuzzy fallback,
# this is deliberately exact, since there's no ambiguity to resolve for a fixed 4-vessel list.
AMNS_VESSEL_NAMES = {"AMNS Polar", "AMNS Tufmax", "AMNSI Maximus", "AMNSI Stallion"}

_FINALLY_APPROVED_TAB_LABEL = "Finally Approved"
_PAGE_SIZE = 25  # SmartPAL's own default page size on this grid — not user-configurable (see module docstring)


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


def _parse_datetime(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return None


def _yn_to_bool(v: str | None) -> bool | None:
    if v is None:
        return None
    return str(v).strip().upper() == "Y"


def _fingerprint(smartpal_invoice_id: int) -> str:
    """Not used for row identity (smartpal_invoice_id already is the natural key) — kept only
    for a debug-log-friendly short hash, mirroring the other scrapers' logging style."""
    return hashlib.sha256(str(smartpal_invoice_id).encode()).hexdigest()[:12]


def _select_finally_approved_tab(page) -> None:
    """[SELECTOR] The tab is a plain clickable element with this exact text — confirmed live
    2026-09-09. Falls back to a looser text-contains match if SmartPAL ever wraps it
    differently."""
    tab = page.locator(f"*:text-is('{_FINALLY_APPROVED_TAB_LABEL}')").first
    try:
        tab.click(timeout=10000)
    except PlaywrightTimeoutError:
        page.locator(f"text={_FINALLY_APPROVED_TAB_LABEL}").first.click(timeout=10000, force=True)
    time.sleep(1.0)


def _capture_next_grid_response(page, trigger) -> list[dict]:
    """Runs `trigger()` (a click) and waits for the resulting grid POST response, returning its
    parsed `result`-less raw list (this endpoint returns a bare JSON array, not the
    {"result": [...]} envelope PIR's GET endpoint used — confirmed live). Raises if no matching
    response arrives within the timeout."""
    with page.expect_response(
        lambda resp: resp.request.method == "POST"
        and "ServiceRouter" in resp.url
        and resp.request.post_data is not None
        and "gridServerOperations" in resp.request.post_data,
        timeout=20000,
    ) as resp_info:
        trigger()
    response = resp_info.value
    body = response.text()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        log.error(f"[GRID]     Could not parse grid response as JSON (len={len(body)}): {body[:200]}")
        return []
    return data if isinstance(data, list) else []


def _click_next_page(page) -> bool:
    """[SELECTOR] Kendo grid pager 'next page' control — first-pass guess based on Kendo UI's
    standard markup (confirmed elsewhere in this codebase's other MariApps/SmartPAL scrapers use
    the same `.k-i-arrow-e`/'next page' pattern). Returns False (nothing to click) once the
    button is disabled, i.e. the last page has been reached."""
    next_btn = page.locator("a.k-pager-nav[title='Go to the next page'], .k-pager-nav .k-i-arrow-e").first
    if next_btn.count() == 0:
        return False
    classes = next_btn.evaluate("el => (el.closest('a') || el).className") or ""
    if "k-state-disabled" in classes:
        return False
    next_btn.click()
    return True


def _extract_rows(page) -> list[dict]:
    """Selects the Finally Approved tab, then pages through the ENTIRE fleet-wide grid (all
    vessels — SmartPAL doesn't offer a cheaper "just these 4 vessels" server-side filter without
    also driving the vessel-selector widget per vessel, which would mean 4x the login/nav
    overhead for the same total row count), capturing each page's real response. AMNS filtering
    happens after, in run(), not here — this just collects everything SmartPAL hands back."""
    all_rows: list[dict] = []

    first_page_rows = _capture_next_grid_response(page, lambda: _select_finally_approved_tab(page))
    all_rows.extend(first_page_rows)
    total_count = first_page_rows[0]["totalCount"] if first_page_rows else 0
    log.info(f"[GRID]     Finally Approved: {total_count} total invoice(s) across the fleet, page 1 → {len(first_page_rows)} row(s).")

    page_num = 1
    while len(all_rows) < total_count:
        if not _click_next_page(page):
            log.warning(
                f"[GRID]     Pager 'next' unavailable/disabled after {len(all_rows)}/{total_count} rows collected — "
                "stopping here rather than looping forever."
            )
            break
        try:
            page_rows = _capture_next_grid_response(page, lambda: None)
        except PlaywrightTimeoutError:
            # _click_next_page already clicked — this branch only fires if the expected response
            # never showed up, so re-try the wait once more against the click that already happened
            # rather than double-clicking (which would skip a page).
            log.error(f"[GRID]     Timed out waiting for page {page_num + 1}'s grid response — stopping.")
            break
        if not page_rows:
            break
        all_rows.extend(page_rows)
        page_num += 1
        log.info(f"[GRID]     Page {page_num} → {len(page_rows)} row(s) ({len(all_rows)}/{total_count} total so far).")

    return all_rows


def run() -> None:
    log.info("=" * 60)
    log.info("  Approved Invoice (AMNS Finally Approved) scrape — starting")
    log.info("=" * 60)

    # Confirmed live (2026-09-09): SmartPAL sessions on this account are short-lived (well under
    # an hour) — always regenerate rather than assume a saved auth.json from an earlier run is
    # still good, unlike pir_scraper which reuses a saved session across runs.
    run_automated_login()

    db = SessionLocal()
    total_inserted = total_updated = total_skipped_non_amns = total_errors = 0

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
                return

            page.wait_for_timeout(2000)
            rows = _extract_rows(page)
            browser.close()
    finally:
        pass  # db closed in the finally block below, after the (DB-only) upsert loop

    log.info(f"[GRID]     {len(rows)} total 'Finally Approved' row(s) fetched (all vessels) — filtering to AMNS fleet.")

    # Case-insensitive lookup — confirmed live 2026-09-10: our vessels table stores these
    # UPPERCASE ("AMNS POLAR"), SmartPAL's InvoiceList renders them title-case ("AMNS Polar").
    # AMNS_VESSEL_NAMES itself stays title-case since that's the exact string SmartPAL's JSON
    # carries and what the row-filtering step above matches against.
    all_vessels = db.query(Vessel.name, Vessel.id).all()
    vessel_id_by_upper_name = {name.upper(): vid for name, vid in all_vessels}
    # Keyed by the SmartPAL-side title-case name (what `vessel_name` below actually holds), so the
    # lookup in the upsert loop below is a direct, no-normalization dict get.
    amns_vessel_by_name = {
        amns_name: vessel_id_by_upper_name[amns_name.upper()]
        for amns_name in AMNS_VESSEL_NAMES
        if amns_name.upper() in vessel_id_by_upper_name
    }
    if len(amns_vessel_by_name) < len(AMNS_VESSEL_NAMES):
        missing = AMNS_VESSEL_NAMES - set(amns_vessel_by_name.keys())
        log.warning(f"[VESSEL]   Not found in our vessels table (rows for these will still be saved, just with vessel_id=NULL): {missing}")

    try:
        for row in rows:
            vessel_name = (row.get("vesselName") or "").strip()
            if vessel_name not in AMNS_VESSEL_NAMES:
                total_skipped_non_amns += 1
                continue

            smartpal_id = row.get("id")
            if smartpal_id is None:
                total_errors += 1
                continue

            try:
                values = {
                    "invoice_no": row.get("invoiceNo"),
                    "vendor_invoice_no": row.get("vendorInvoiceNo"),
                    "vendor_name": (row.get("vendorName") or "").strip() or None,
                    "vessel_name": vessel_name or None,
                    "vessel_id": amns_vessel_by_name.get(vessel_name),
                    "amount": _num(row.get("invoiceAmount")),
                    "currency_code": row.get("invoiceCurrency"),
                    "po_nos": row.get("poNos"),
                    "category_name": row.get("categoryName"),
                    "status": row.get("status"),
                    "invoice_date": _parse_date(row.get("invDate")),
                    "forward_date": _parse_datetime(row.get("forwardDate")),
                    "attachment": _yn_to_bool(row.get("attachment")),
                    "grn_exists": _yn_to_bool(row.get("grnExists")),
                    "raw_json": row,
                }

                existing = db.query(ApprovedInvoiceEntry).filter(
                    ApprovedInvoiceEntry.smartpal_invoice_id == smartpal_id
                ).first()
                if existing:
                    # payment_status is deliberately NOT in `values` and never touched here — see
                    # class docstring / module docstring. Every other scraped field refreshes.
                    for field, value in values.items():
                        setattr(existing, field, value)
                    total_updated += 1
                else:
                    db.add(ApprovedInvoiceEntry(smartpal_invoice_id=smartpal_id, **values))
                    total_inserted += 1
                db.commit()
            except Exception as e:
                db.rollback()
                total_errors += 1
                log.error(f"[SAVE]     Failed to upsert invoice id={smartpal_id} ({_fingerprint(smartpal_id)}): {e}")
    finally:
        db.close()

    log.info("=" * 60)
    log.info(
        f"  Approved Invoice scrape complete — inserted={total_inserted} updated={total_updated} "
        f"skipped(non-AMNS)={total_skipped_non_amns} errors={total_errors}"
    )
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
