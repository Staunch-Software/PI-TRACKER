# ===========================================================================
# backend/app/services/pir_scraper/scraper.py
#
# Scrapes SmartPAL's "Problematic Invoice Resolution" page (Accounts > I2P >
# Problematic Invoice Overview) — modeled after Vessel_Performance's
# bunker_report_scraper.py, but simpler: rather than parsing the Kendo grid's
# DOM (that grid's locked/scrollable column split + virtual scrolling made
# rows impossible to reliably locate/click headlessly — confirmed live,
# `a.showInvoiceDetails` links never became "visible" to Playwright even
# though they exist in the DOM), this drives the page just enough to trigger
# its own "Show" action and reads the same api/ServiceRouter/GET JSON response
# the grid itself consumes. That response is the full, clean row set — no
# pagination, no per-row cell-index guessing.
#
# CONFIRMED live (2026-09-02): setting the two Kendo date pickers via
# `jQuery('#fromDate').data('kendoDatePicker').value(...)` + `.trigger('change')`
# and clicking the real "Show" button (`.btn-icon-apply-search-result`) is
# what the app's own JS (problematicinvoiceoverview.js: showBtnClickEvent)
# does — reproducing it exactly (rather than typing into the date inputs, the
# approach bunker_report_scraper.py used) sidesteps needing the DOM to be
# genuinely "visible" for typing, and reliably returned 1881 rows for a
# 01-Jan-2019 to today sweep.
#
# This is a LIVE-SNAPSHOT scrape, not an append-only transaction log — every
# run UPSERTS by smartpal_invoice_id (SmartPAL's own row id) rather than
# skip-if-seen, since a problematic invoice's fields can be corrected in
# SmartPAL after the fact. See app/models/pir_entry.py for why department
# (Technical/Manning/Unclassified) is deliberately not stored here.
#
# Also scrapes pir_rejections (who rejected each invoice and when) from this same page's
# "Rejected invoice" category (pCategoryId=-100) — see _scrape_rejections below. Confirmed live
# 2026-10-02 that per-row interaction on THIS grid, despite the module-docstring warning above
# about `a.showInvoiceDetails` never being clickable, DOES work for the "Audit Trial" icon once
# two gotchas are handled: (1) the column header carries a DECOY icon with the identical `title`
# attribute as the real per-row ones (a static tooltip, not a row control — must be excluded via
# `.closest('th')`); (2) the grid virtualizes rows, and the obvious scroll container
# (`.k-grid-content`) does NOT trigger Kendo to render more of them — only scrolling the actual
# proxy scrollbar element (`.k-scrollbar.k-scrollbar-vertical`) does. With both of those, real
# per-row clicks (JS-dispatched, not Playwright's native `.click()` — same "some rows' handlers
# don't fire from a native click" gotcha as approved_invoice_scraper) were 100% reliable across a
# 20-row live test.
# ===========================================================================
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.pir_entry import PirEntry
from app.models.pir_rejection import PirRejection
from app.services.vendor_mapping_importer import normalize_vendor_name
from .generate_auth import run_automated_login

log = logging.getLogger(__name__)

_REJECTED_CATEGORY_LABEL = "Rejected invoice"
_REJECTED_ACTION = "REJECTED"
# A few consecutive scroll rounds that reveal no new (not-yet-seen) invoice number means we've
# reached the end of the virtualized grid — stop rather than scroll forever.
_MAX_STAGNANT_SCROLL_ROUNDS = 3

# The app's own deep-link default (see problematicinvoiceoverview.js
# settingInitialDefaultLoadingData) — a safe "beginning of time" for this
# system. TO_DATE is always "today" so every run re-sweeps the whole window;
# the upsert-by-smartpal_invoice_id is what keeps re-runs cheap and correct.
FROM_DATE = date(2019, 1, 1)


def _to_smartpal_date(d: date) -> str:
    return d.strftime("%d-%b-%Y")


def _num(v) -> Decimal | None:
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except InvalidOperation:
        return None


def _parse_date(v) -> date | None:
    if not v:
        return None
    try:
        # SmartPAL returns e.g. "2026-06-04T00:00:00"
        return datetime.fromisoformat(str(v)).date()
    except ValueError:
        return None


def _js_ymd(d: date) -> list[int]:
    """[year, zero-indexed-month, day] — the triple `new Date(y, m, d)` expects in JS."""
    return [d.year, d.month - 1, d.day]


def _fetch_rows(page) -> list[dict]:
    """Navigates to the PIR page, sets the date range to the full sweep window
    via the real Kendo date pickers, clicks the real Show button, and returns
    the JSON rows from the api/ServiceRouter/GET response that triggers."""
    captured: list[dict] = []

    def on_response(resp):
        if "ServiceRouter/GET" in resp.url and "pCategoryId" in resp.url:
            try:
                captured.append(resp.json())
            except Exception as e:
                log.warning(f"[API]      Failed to parse a ServiceRouter response as JSON: {e}")

    page.on("response", on_response)

    log.info(f"[NAV]      Navigating to: {settings.pir_url}")
    page.goto(settings.pir_url, wait_until="load", timeout=60000)

    if "login" in page.url.lower() or "SIGN IN" in (page.content() or ""):
        raise RuntimeError("Session expired / not authenticated — SmartPAL bounced to the login page.")

    page.wait_for_selector("#fromDate", timeout=30000)
    page.wait_for_timeout(1000)  # let the SPA's own default-range fetch (which we discard) settle first

    from_str = _to_smartpal_date(FROM_DATE)
    to_str = _to_smartpal_date(datetime.now().date())
    log.info(f"[CONFIG]   Date range: {from_str} -> {to_str}")

    before = len(captured)
    page.evaluate(
        """([fromYmd, toYmd]) => {
            const [fy, fm, fd] = fromYmd; const [ty, tm, td] = toYmd;
            const from = jQuery('#fromDate').data('kendoDatePicker');
            const to = jQuery('#toDate').data('kendoDatePicker');
            from.value(new Date(fy, fm, fd)); from.trigger('change');
            to.value(new Date(ty, tm, td)); to.trigger('change');
        }""",
        [_js_ymd(FROM_DATE), _js_ymd(datetime.now().date())],
    )
    page.wait_for_timeout(500)

    page.locator(".btn-icon-apply-search-result").click()

    # `captured` grows in the Python-side response listener above, not something observable
    # from inside the page — poll it directly rather than trying to wait_for_function on it.
    for _ in range(40):
        if len(captured) > before:
            break
        page.wait_for_timeout(500)

    if len(captured) <= before:
        raise RuntimeError("Show click did not produce a new ServiceRouter response within 20s.")

    payload = captured[-1]
    if payload.get("isError"):
        raise RuntimeError(f"SmartPAL API returned an error: {payload}")

    return payload.get("result") or []


def _js_ymd(d: date) -> list[int]:
    return [d.year, d.month - 1, d.day]


def _select_rejected_category(page) -> None:
    """[SELECTOR] Sidebar category link — plain clickable text, same pattern as the tab-click
    convention used elsewhere in this codebase's other MariApps/SmartPAL scrapers."""
    page.locator(f"*:text-is('{_REJECTED_CATEGORY_LABEL}')").first.click(timeout=10000)
    page.wait_for_timeout(2000)


def _scroll_grid_further(page, scroll_top: int) -> bool:
    """Advances the grid's virtual-scroll window. Confirmed live 2026-10-02 that scrolling the
    obvious container (`.k-grid-content`) does nothing — Kendo only renders more rows when the
    actual proxy scrollbar element's scrollTop changes and a real `scroll` event fires on it.

    Returns False (rather than crashing the whole run) if the scrollbar element can't be found —
    confirmed live 2026-10-02 this happens when every row has already been rendered (Kendo removes
    or hides the scrollbar once there's nothing left to virtualize), which the caller should treat
    as "reached the end", not an error."""
    scrollbar = page.locator(".k-scrollbar.k-scrollbar-vertical").first
    try:
        scrollbar.wait_for(state="attached", timeout=5000)
    except PlaywrightTimeoutError:
        return False
    try:
        scrollbar.evaluate(
            f"el => {{ el.scrollTop = {scroll_top}; el.dispatchEvent(new Event('scroll', {{bubbles: true}})); }}"
        )
    except Exception as e:
        log.warning(f"[REJ]      Scroll attempt failed ({e}) — treating as end of grid.")
        return False
    page.wait_for_timeout(800)
    return True


def _visible_row_links(page) -> list:
    """Every currently-rendered grid row's invoice-number link, in DOM order — only a window of
    rows exists at a time (virtual scrolling), so this must be re-queried after every scroll."""
    return page.locator("td a").all()


def _fetch_rejection_history(page, link) -> list[dict]:
    """Clicks the given row's Audit Trial icon (JS-dispatched — confirmed live 2026-10-02 that
    Playwright's native `.click()` doesn't reliably trigger it, same gotcha as
    approved_invoice_scraper's invoice links) and returns the parsed audit-trail array. No page
    navigation happens — the data arrives via a plain API response, no modal content to read."""
    row = link.locator("xpath=ancestor::tr[1]")
    # Excludes the column header's decoy icon (same `title`, a static tooltip, not a row control)
    # by scoping to this specific row's own <td> — see module docstring.
    icon = row.locator("button.btn-info-icon.i2pPopUpClick, i.btn-info-icon").first
    if icon.count() == 0:
        raise RuntimeError("No Audit Trial icon found in this row")
    with page.expect_response(lambda resp: "pInvoiceId" in resp.url, timeout=10000) as resp_info:
        icon.evaluate("el => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}))")
    data = resp_info.value.json()
    if data.get("isError"):
        raise RuntimeError(f"Audit trail API error: {data}")
    # Dismiss whatever popup this opened before moving to the next row — Escape is enough since,
    # unlike approved_invoice_scraper's modal, there's no page to navigate back from here.
    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    return data.get("result") or []


def _scrape_rejections(page, db, existing_invoice_nos: set[str]) -> dict:
    """Walks the "Rejected invoice" category, scrolling through the whole virtualized grid, and
    for each invoice not already in pir_rejections, fetches its audit trail and stores the
    "REJECTED" action's actor/date/remarks. See module docstring for the two selector gotchas
    (decoy header icon, real scrollbar element) that make this reliable.

    Confirmed live 2026-10-02 that rejected invoices are NOT a subset of the main "All"
    (pCategoryId=-1) sweep _fetch_rows returns — they're excluded from it entirely once rejected,
    the same way resolved_at rows eventually drop out of future sweeps — so the smartpal id can't
    be pre-resolved from `rows`. It comes from the audit-trail response itself instead (every
    history entry carries the invoice's own "id"), and the skip-already-scraped check is keyed by
    invoice_no (known before clicking, from the DOM) rather than id (only known after)."""
    counters = {"fetched": 0, "found": 0, "errors": 0}
    log.info(f"[REJ]      Selecting '{_REJECTED_CATEGORY_LABEL}' category...")
    _select_rejected_category(page)

    seen_invoice_nos: set[str] = set()
    scroll_top = 0
    stagnant_rounds = 0

    while stagnant_rounds < _MAX_STAGNANT_SCROLL_ROUNDS:
        links = _visible_row_links(page)
        progressed = False
        for link in links:
            try:
                invoice_no = link.inner_text(timeout=1000).strip()
            except Exception:
                continue
            if not invoice_no or invoice_no in seen_invoice_nos:
                continue
            seen_invoice_nos.add(invoice_no)
            progressed = True

            if invoice_no in existing_invoice_nos:
                continue

            try:
                history = _fetch_rejection_history(page, link)
                smartpal_id = next((h.get("id") for h in history if h.get("id") is not None), None)
                if smartpal_id is None:
                    raise RuntimeError("Audit trail response had no 'id' field on any row")
                rejected_entry = next((h for h in history if h.get("action") == _REJECTED_ACTION), None)
                db.add(
                    PirRejection(
                        smartpal_invoice_id=smartpal_id,
                        invoice_no=invoice_no,
                        rejected_by=(rejected_entry or {}).get("actionBy"),
                        rejected_date=_parse_datetime((rejected_entry or {}).get("actionDate")),
                        remarks=(rejected_entry or {}).get("remarks"),
                        raw_json=history,
                    )
                )
                db.commit()
                existing_invoice_nos.add(invoice_no)
                counters["fetched"] += 1
                if rejected_entry:
                    counters["found"] += 1
            except Exception as e:
                db.rollback()
                counters["errors"] += 1
                log.error(f"[REJ]      Failed to fetch audit trail for {invoice_no!r}: {e}")

        if progressed:
            stagnant_rounds = 0
        else:
            stagnant_rounds += 1
        scroll_top += 1500
        if not _scroll_grid_further(page, scroll_top):
            log.info("[REJ]      No scrollbar found — reached the end of the grid.")
            break

    log.info(f"[REJ]      Rejection scrape complete — {len(seen_invoice_nos)} row(s) seen, {counters}")
    return counters


def _parse_datetime(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        return None


def run() -> None:
    if not MARIAPPS_AUTH_JSON.exists():
        log.info("[AUTH]     No saved session found — running automated login first.")
        run_automated_login()

    db = SessionLocal()
    inserted = updated = errors = 0
    # Queried up front (DB-only, no page needed) so _scrape_rejections can skip already-known
    # rejections without a second round-trip once we're inside the browser session below.
    existing_rejection_invoice_nos = {r[0] for r in db.query(PirRejection.invoice_no).all()}
    rejection_counters = {"fetched": 0, "found": 0, "errors": 0}

    try:
        # Each attempt gets its OWN `with sync_playwright()` block — Playwright's sync API
        # doesn't support starting a second driver (via run_automated_login()'s own
        # sync_playwright() call) while an outer one is still open, even after closing its
        # browser; confirmed live it raises "using Playwright Sync API inside the asyncio loop"
        # rather than actually retrying. So the retry-on-expired-session path must fully exit
        # this block (ending the `with`) before calling run_automated_login(), then open a fresh
        # one for the second attempt.
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                page = context.new_page()
                rows = _fetch_rows(page)
                rejection_counters = _scrape_rejections(page, db, existing_rejection_invoice_nos)
                browser.close()
        except RuntimeError as e:
            if "expired" not in str(e).lower() and "not authenticated" not in str(e).lower():
                raise
            log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
            run_automated_login()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                page = context.new_page()
                rows = _fetch_rows(page)
                rejection_counters = _scrape_rejections(page, db, existing_rejection_invoice_nos)
                browser.close()

        log.info(f"[API]      {len(rows)} PIR row(s) returned.")

        for r in rows:
            smartpal_id = r.get("id")
            if smartpal_id is None:
                continue

            vendor_name = (r.get("vendorName") or "").strip() or None
            values = {
                "document_id": r.get("documentId"),
                "invoice_no": r.get("invoiceNo"),
                "reg_invoice_no": r.get("regInvoiceNo"),
                "vendor_invoice_no": r.get("vendorInvoiceNo"),
                "vendor_name": vendor_name,
                "vendor_name_normalized": normalize_vendor_name(vendor_name) if vendor_name else None,
                "vessel_name": r.get("vesselName"),
                "company_name": r.get("companyName"),
                "vendor_bank_name": r.get("vendorBankName"),
                "vendor_account_code": r.get("vendorAccountCode"),
                "vendor_swift_code": r.get("vendorSwiftCode"),
                "reg_date": _parse_date(r.get("regDate")),
                "frwd_from": r.get("frwdFrom"),
                "amount": _num(r.get("amount")),
                "status": r.get("status"),
                "po_nos": r.get("poNos"),
                "currency_code": r.get("currencyCode"),
                "total_datapoints": r.get("totalDatapoints"),
                "available_data_points": r.get("availableDataPoints"),
                "modified_from_pal": r.get("modifiedFromPAL"),
                "reject_remark": r.get("rejectRemark"),
                "raw_json": r,
            }

            try:
                existing = db.query(PirEntry).filter(PirEntry.smartpal_invoice_id == smartpal_id).first()
                now = datetime.now(timezone.utc)
                if existing:
                    for field, value in values.items():
                        setattr(existing, field, value)
                    existing.last_scraped_at = now
                    # Still showing up in a live sweep — if it was previously marked resolved
                    # (see PirEntry.resolved_at docstring), SmartPAL has re-flagged it as
                    # problematic again, so it's reopened.
                    existing.resolved_at = None
                    updated += 1
                else:
                    db.add(PirEntry(smartpal_invoice_id=smartpal_id, last_scraped_at=now, **values))
                    inserted += 1
                db.commit()
            except Exception as e:
                db.rollback()
                errors += 1
                log.error(f"[SAVE]     Failed to upsert PIR invoice id={smartpal_id}: {e}")

        # Anything still marked open in our table but absent from this full sweep has been
        # resolved in SmartPAL since the last scrape (paid, corrected, or otherwise pushed
        # through to normal invoice processing) — see PirEntry.resolved_at docstring. FROM_DATE
        # covers the app's own "beginning of time", so this comparison is against the complete
        # open set, not a partial window.
        scraped_ids = {r.get("id") for r in rows if r.get("id") is not None}
        resolved_now = datetime.now(timezone.utc)
        resolved = (
            db.query(PirEntry)
            .filter(PirEntry.resolved_at.is_(None), ~PirEntry.smartpal_invoice_id.in_(scraped_ids))
            .update({"resolved_at": resolved_now}, synchronize_session=False)
            if scraped_ids
            else 0
        )
        db.commit()

    finally:
        db.close()

    log.info("=" * 60)
    log.info(f"  PIR scrape complete — inserted={inserted} updated={updated} resolved={resolved} errors={errors}")
    log.info(
        f"  Rejection scrape complete — fetched={rejection_counters['fetched']} "
        f"found_rejected_row={rejection_counters['found']} errors={rejection_counters['errors']}"
    )
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
