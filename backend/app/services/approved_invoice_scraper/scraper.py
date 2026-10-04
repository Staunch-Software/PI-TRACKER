# ===========================================================================
# backend/app/services/approved_invoice_scraper/scraper.py
#
# Scrapes SmartPAL's Purchase > Transactions > Invoice Approval page
# (PurchasePALApp/Purchase/InvoiceList), "All" tab (every category, every
# vessel — confirmed live 2026-09-29 this is the same "All Vessels" list the
# UI defaults to, ~1942 rows). Two independent things are built from that one
# fetched row set:
#
#   1. approved_invoice_entries — unchanged from before: filtered down to the
#      4 AMNS-fleet vessels' rows only (see AMNS_VESSEL_NAMES below).
#   2. invoice_registrations — NEW, covers every row regardless of vessel:
#      who registered each invoice and when, fetched via a second, per-invoice
#      real click-through (see _fetch_registration_for_row) rather than from
#      this grid response, which doesn't carry that data. Confirmed live
#      2026-09-30 that this per-invoice data can NOT be fetched by replaying
#      its URL directly — the endpoint 500s without several custom headers
#      (vessel context + a session-scoped token) only a real browser click
#      sets, so this drives the actual UI per invoice instead.
#
#      Also confirmed live 2026-09-30 that looking each invoice up via the
#      grid's own "Search Invoice No." autocomplete box is NOT reliable at
#      scale — it works for an isolated one-off call but consistently breaks
#      down (stops finding anything) after the first few invoices in a loop,
#      for a reason not fully understood (not a selector/timing bug we could
#      find; possibly some session/widget state that degrades under repeated
#      use). The reliable alternative, used here instead: walk the SAME pager
#      already proven reliable for _extract_rows, and for each row on the
#      CURRENTLY DISPLAYED page, click its own link directly (no search),
#      open its detail page, click the real history icon, then return via the
#      detail page's own in-app back arrow (which preserves the exact
#      tab/page/pager position) before moving to the next row or page. Slow
#      on the first full backfill (one click+click+click per invoice, ~1900
#      of them) but only ever touches NEW invoices on later runs, since a
#      registration event never changes once recorded.
#
# Reads the grid via SmartPAL's own JSON API (PurchasePALApp/api/
# ServiceRouter/POST) rather than DOM-scraping the Kendo grid — same
# "prefer the clean API over the DOM" approach as pir_scraper, and this one's
# record shape is even cleaner than PIR's (real field names, no locked/
# scrollable table split to fight). Confirmed live that a bare `fetch()`
# with a hand-rolled body (or the exact real body with only pageSize bumped)
# gets rejected by the server (500) — so this drives the REAL pager "Next"
# button via Playwright and captures each page's genuine response instead of
# trying to force a bigger page in one call. That's slower (~1942 rows,
# 25/page = ~78 clicks) but doesn't depend on guessing what the server will
# accept.
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
from app.models.invoice_registration import InvoiceRegistration
from app.models.vessel import Vessel
from .generate_auth import run_automated_login

log = logging.getLogger(__name__)

# Confirmed live (2026-09-09) — exact vesselName strings as SmartPAL renders them on the
# "Finally Approved" tab. Only these 4 rows are kept; everything else in the fleet-wide
# response is discarded. If SmartPAL ever renders a 5th naming variant for one of these
# vessels, it will silently NOT match here — unlike pir_vessel_matcher.py's fuzzy fallback,
# this is deliberately exact, since there's no ambiguity to resolve for a fixed 4-vessel list.
AMNS_VESSEL_NAMES = {"AMNS Polar", "AMNS Tufmax", "AMNSI Maximus", "AMNSI Stallion"}

_ALL_TAB_LABEL = "All"
_PAGE_SIZE = 25  # SmartPAL's own default page size on this grid — not user-configurable (see module docstring)

# The status row we care about in a per-invoice approval chain — see _fetch_registration_chain.
_REGISTERED_STATUS = "Registered"


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


def _select_all_tab(page) -> None:
    """[SELECTOR] The tab is a plain clickable element with this exact text — confirmed live
    2026-09-09 (Finally Approved tab) and 2026-09-29 (All tab, same markup). Falls back to a
    looser text-contains match if SmartPAL ever wraps it differently."""
    tab = page.locator(f"*:text-is('{_ALL_TAB_LABEL}')").first
    try:
        tab.click(timeout=10000)
    except PlaywrightTimeoutError:
        page.locator(f"text={_ALL_TAB_LABEL}").first.click(timeout=10000, force=True)
    time.sleep(1.0)


def _click_history_icon_and_capture(page) -> list[dict]:
    """Clicks the real clock/history icon (`button.btn-icon-history` — confirmed live 2026-09-30;
    a same-page `.vessel-history` div with a similar class name is a permanently-hidden decoy, NOT
    the real control) on an already-open invoice detail page, capturing the genuine Pending List
    response it triggers. Returns the bare JSON array of approval-chain rows
    (Pending/Approved/Verified/Registered), most-recent-first. Leaves the resulting popup open —
    see _close_popup_and_return_to_grid, which the caller must run afterward.

    Deliberately does NOT hand-build and replay the endpoint's URL directly, even though it looks
    like a plain `docId`-keyed GET: confirmed live 2026-09-30 that SmartPAL's frontend attaches
    several custom headers to this call that only the real browser sets (vessel context — v_id,
    v_code, v_objectid, v_name, v_coid — plus a session-scoped s_key and a servicepath header the
    single shared ServiceRouter endpoint dispatches on). A replay without them 500s every time,
    including for invoices confirmed to work via a real click. Same "drive the real control,
    don't guess the request" lesson as _capture_next_grid_response above."""
    with page.expect_response(
        lambda resp: resp.request.method == "GET" and "docId" in resp.url and "pageType" in resp.url,
        timeout=15000,
    ) as resp_info:
        icon = page.locator("button.btn-icon-history").first
        icon.wait_for(state="visible", timeout=10000)
        icon.click(timeout=5000)
    response = resp_info.value
    if not response.ok:
        raise RuntimeError(f"Pending-list request failed: HTTP {response.status}")
    data = json.loads(response.text())
    return data if isinstance(data, list) else []


def _jump_to_page(page, page_num: int) -> bool:
    """Clicks the pager's own numbered button for `page_num` directly — an O(1) way back to a
    specific page, needed because `a.back-btn` always resets the grid to page 1 regardless of
    where we came from (confirmed live 2026-09-30 — NOT the "same tab/page" restore it looks like
    at a glance). Confirmed live that the target page number is always visible in Kendo's pager
    number window immediately after we've just arrived there via _click_next_page, so this doesn't
    need to handle the "..." overflow a truly random jump would require.

    Waits for the button rather than an instant `.count()` check — confirmed live 2026-09-30 that
    right after the back-arrow's page-1 reset, the pager sometimes hasn't finished re-rendering
    yet, so an instant count() can see 0 even though the button appears half a second later; that
    false-negative was cascading into every remaining row on the page also failing, since nothing
    ever got the grid back to the right page. Returns False (after genuinely waiting) if the
    button really isn't there, so the caller can log rather than silently continue on the wrong
    page."""
    btn = page.locator(f".k-pager-numbers a:text-is('{page_num}')").first
    try:
        btn.wait_for(state="visible", timeout=8000)
    except PlaywrightTimeoutError:
        # Confirmed live 2026-10-01: for pages far from 1 (e.g. page 77 of ~77), the button isn't
        # just slow to render — it's genuinely not in the pager's visible number window, which
        # resets to showing 1-10 after the page-1 reset (the assumption in this function's main
        # docstring only holds close to the start of the grid). Fall back to walking there one
        # page at a time via the ordinary Next button, which works regardless of window position.
        log.warning(f"[REG]      Page-{page_num} button not in the pager's visible window — falling back to repeated Next clicks.")
        current = page.locator(".k-pager-numbers .k-state-selected").first
        try:
            start_page = int(current.inner_text(timeout=2000).strip())
        except Exception:
            start_page = 1
        for _ in range(page_num - start_page):
            if not _click_next_page(page):
                return False
            try:
                _capture_next_grid_response(page, lambda: None)
            except PlaywrightTimeoutError:
                return False
        return True
    with page.expect_response(
        lambda resp: resp.request.method == "POST"
        and "ServiceRouter" in resp.url
        and resp.request.post_data is not None
        and "gridServerOperations" in resp.request.post_data,
        timeout=15000,
    ):
        btn.click(timeout=5000)
    page.wait_for_timeout(500)
    return True


def _current_pager_page(page) -> int | None:
    """Reads the pager's own idea of which page is currently selected (the `k-state-selected`
    number bubble), or None if it can't be read within a short timeout. Used to verify recovery
    actually landed where expected rather than assuming it did."""
    try:
        text = page.locator(".k-pager-numbers .k-state-selected").first.inner_text(timeout=3000)
        return int(text.strip())
    except Exception:
        return None


def _recover_to_grid_page(page, page_num: int) -> None:
    """Best-effort recovery to `page_num` of the Invoice List grid, run from
    _fetch_registration_for_row's finally block UNCONDITIONALLY — regardless of whether the
    attempt got as far as opening the popup, only as far as the detail page, or failed before even
    that (e.g. the initial row-link click itself timed out). Confirmed live 2026-09-30 that an
    earlier version only ran this recovery on the success path (inside a narrower try/finally that
    didn't cover the initial link click) — when that first click failed, the grid was left
    mispositioned and EVERY subsequent row on the page failed too, since nothing ever re-synced
    it. This is deliberately tolerant of already being back on the list (Escape/go_back simply
    no-op there) so it's safe to call no matter how far the attempt got.

    Clicking the history icon opens a visible modal popup — confirmed live 2026-09-30 it stays
    open and blocks normal interaction until dismissed, so Escape runs first. Returns to the grid
    via the BROWSER's own back navigation (`page.go_back()`), NOT the app's own in-page back-arrow
    (`a.back-btn`) — confirmed live 2026-10-01 that `go_back()` correctly preserves the exact
    page/pager position we came from (verified at page 5 of ~77: identical row set and pager range
    before and after), whereas `a.back-btn` always resets to page 1 regardless of where we came
    from, which was forcing an expensive page-by-page walk back on every single row once past the
    pager's default 1-10 button window. _jump_to_page is kept only as a last-resort repair for the
    rare case go_back() doesn't land on the expected page."""
    try:
        if "InvoiceDetail" in page.url:
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
            page.go_back()
            try:
                page.wait_for_url("**/InvoiceList**", timeout=10000)
            except PlaywrightTimeoutError:
                log.warning(f"[REG]      go_back() didn't reach InvoiceList within 10s (still on {page.url}).")
        if page_num > 1 and "InvoiceList" in page.url:
            current = _current_pager_page(page)
            if current != page_num:
                log.warning(f"[REG]      After recovery, pager shows page {current}, expected {page_num} — falling back to _jump_to_page.")
                if not _jump_to_page(page, page_num):
                    log.warning(f"[REG]      Could not find page-{page_num} button to jump back to — next lookups on this page may fail to find their row.")
    except Exception as e:
        log.warning(f"[REG]      Recovery to grid page {page_num} hit an error of its own: {e}")


def _fetch_registration_for_row(page, invoice_no: str, page_num: int) -> list[dict]:
    """Clicks the given invoice's row link — which must already be visible on the CURRENTLY
    DISPLAYED grid page, see _process_page_registrations — opens its detail page, captures its
    Pending List via a real history-icon click, then returns to `page_num` of the grid (even on
    failure — see _recover_to_grid_page) so the caller can continue with the rest of the current
    page or advance the pager."""
    try:
        link = page.locator(f"a:text-is('{invoice_no}')").first
        link.wait_for(state="visible", timeout=8000)
        # Dispatching a real DOM click event via JS, NOT Playwright's own .click() — confirmed
        # live 2026-09-30 that Playwright's synthetic click (even with force=True) silently fails
        # to trigger this specific link's Knockout-bound click handler for SOME invoices (no
        # navigation, no console/page error, nothing happens), while a directly-dispatched
        # bubbling MouseEvent works every time. This was the actual root cause of what looked like
        # cascading/session-degradation failures throughout today's investigation: one invoice's
        # click silently no-opping left the grid mispositioned for every row after it.
        link.evaluate("el => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}))")
        try:
            # Properly wait for the navigation rather than a fixed sleep + one-shot check.
            page.wait_for_url("**/InvoiceDetail**", timeout=15000)
        except PlaywrightTimeoutError:
            raise RuntimeError(f"Click on {invoice_no!r} did not navigate to InvoiceDetail (still on {page.url})")
        return _click_history_icon_and_capture(page)
    finally:
        _recover_to_grid_page(page, page_num)


def _process_page_registrations(
    page, db, page_rows: list[dict], existing_ids: set[int], counters: dict, page_num: int
) -> None:
    """For each row on the currently-displayed grid page that doesn't already have a stored
    registration event, fetches and stores it — see module docstring for why this walks the pager
    instead of using the grid's search box."""
    for row in page_rows:
        smartpal_id = row.get("id")
        invoice_no = row.get("invoiceNo")
        if smartpal_id is None or smartpal_id in existing_ids or not invoice_no:
            continue
        try:
            chain = _fetch_registration_for_row(page, invoice_no, page_num)
            registered_row = next((r for r in chain if r.get("status") == _REGISTERED_STATUS), None)
            db.add(
                InvoiceRegistration(
                    smartpal_invoice_id=smartpal_id,
                    invoice_no=invoice_no,
                    registered_by=(registered_row or {}).get("userName"),
                    registered_action_date=_parse_datetime((registered_row or {}).get("actionDate")),
                    raw_json=chain,
                )
            )
            db.commit()
            existing_ids.add(smartpal_id)
            counters["fetched"] += 1
            if registered_row:
                counters["found"] += 1
        except Exception as e:
            db.rollback()
            counters["errors"] += 1
            log.error(f"[REG]      Failed to fetch registration chain for invoice id={smartpal_id} ({invoice_no}): {e}")


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
    # Confirmed live 2026-10-01: a persistent #loading-container overlay (the same one that
    # sometimes blocks the per-invoice history-icon click) can also block this click — and unlike
    # that per-row click, this one wasn't wrapped in error handling, so a stuck overlay here
    # crashed the entire run after a 30s timeout. Wait for it to clear first, with a short overall
    # retry budget, and raise only if it never does — the caller already handles exceptions from
    # the registration-fetch side, but this crashed BEFORE reaching any per-row try/except, so this
    # function now owns its own resilience instead of assuming the overlay is always gone.
    try:
        page.locator("#loading-container").wait_for(state="hidden", timeout=10000)
    except PlaywrightTimeoutError:
        log.warning("[GRID]     #loading-container still visible after 10s — attempting the Next click anyway.")
    try:
        next_btn.click(timeout=15000)
    except PlaywrightTimeoutError:
        log.warning("[GRID]     Next-page click timed out (likely the same stuck loading overlay) — retrying once more.")
        page.wait_for_timeout(2000)
        next_btn.click(timeout=15000)
    return True


def _extract_rows_and_fetch_registrations(page, db, existing_ids: set[int], counters: dict) -> list[dict]:
    """Selects the All tab, then pages through the ENTIRE grid (all vessels, all categories),
    capturing each page's real response. AMNS/category filtering for approved_invoice_entries
    happens after, in run(), not here — this just collects everything SmartPAL hands back.

    Also fetches invoice_registrations for each page's rows (see _process_page_registrations)
    before advancing to the next page, rather than in a separate second pass — this walks the
    pager exactly once instead of twice, and avoids the grid's search box entirely (see module
    docstring for why that's not reliable at scale)."""
    all_rows: list[dict] = []

    # Confirmed live 2026-09-30/2026-10-01: the very first capture after selecting the All tab
    # sometimes races against the default tab's own already-in-flight response (landing page is
    # "Pending", 0 rows) and comes back empty even though there are genuinely ~1900+ invoices —
    # retry with a full page reload a few times rather than let a one-off race end the whole run
    # with 0 rows processed.
    first_page_rows: list[dict] = []
    for attempt in range(1, 4):
        first_page_rows = _capture_next_grid_response(page, lambda: _select_all_tab(page))
        if first_page_rows:
            break
        log.warning(f"[GRID]     Page 1 came back empty (attempt {attempt}/3) — reloading and retrying.")
        page.goto(settings.approved_invoice_list_url, wait_until="load", timeout=60000)
        page.wait_for_timeout(3000)
    all_rows.extend(first_page_rows)
    total_count = first_page_rows[0]["totalCount"] if first_page_rows else 0
    log.info(f"[GRID]     All: {total_count} total invoice(s), page 1 → {len(first_page_rows)} row(s).")
    _process_page_registrations(page, db, first_page_rows, existing_ids, counters, page_num=1)
    log.info(f"[REG]      After page 1: fetched={counters['fetched']} found={counters['found']} errors={counters['errors']}")

    page_num = 1
    while len(all_rows) < total_count:
        try:
            advanced = _click_next_page(page)
        except PlaywrightTimeoutError:
            # Confirmed live 2026-10-01: a persistent loading overlay can make even
            # _click_next_page's own retry fail — this crashed the entire run previously (nothing
            # caught it between here and the top-level script). Stop pagination gracefully instead
            # of losing everything fetched so far; the next run picks up any remaining pages fresh
            # since it always starts from page 1 again.
            log.error(f"[GRID]     Next-page click failed twice in a row after {len(all_rows)}/{total_count} rows — stopping here rather than crashing.")
            break
        if not advanced:
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
        _process_page_registrations(page, db, page_rows, existing_ids, counters, page_num=page_num)
        log.info(
            f"[REG]      After page {page_num}: fetched={counters['fetched']} "
            f"found={counters['found']} errors={counters['errors']}"
        )

    return all_rows


def run() -> None:
    log.info("=" * 60)
    log.info("  Approved Invoice + Registration scrape — starting")
    log.info("=" * 60)

    # Confirmed live (2026-09-09): SmartPAL sessions on this account are short-lived (well under
    # an hour) — always regenerate rather than assume a saved auth.json from an earlier run is
    # still good, unlike pir_scraper which reuses a saved session across runs.
    run_automated_login()

    db = SessionLocal()
    total_inserted = total_updated = total_skipped_non_amns = total_errors = 0
    total_reg_fetched = total_reg_found = total_reg_errors = 0

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

            # Registration-chain fetch is interleaved into the same pager walk that collects
            # `rows` (see _extract_rows_and_fetch_registrations) — needs the still-open,
            # authenticated `page` (its request context carries the session cookies), so this has
            # to happen before browser.close(), unlike the approved_invoice_entries upsert below,
            # which is DB-only.
            existing_ids = {r[0] for r in db.query(InvoiceRegistration.smartpal_invoice_id).all()}
            reg_counters = {"fetched": 0, "found": 0, "errors": 0}
            log.info(f"[REG]      {len(existing_ids)} invoice(s) already have a stored registration event.")
            rows = _extract_rows_and_fetch_registrations(page, db, existing_ids, reg_counters)
            total_reg_fetched, total_reg_found, total_reg_errors = (
                reg_counters["fetched"],
                reg_counters["found"],
                reg_counters["errors"],
            )

            browser.close()
    finally:
        pass  # db closed in the finally block below, after the (DB-only) upsert loop

    log.info(f"[GRID]     {len(rows)} total row(s) fetched (all vessels/categories) — filtering to AMNS fleet.")

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
    log.info(
        f"  Registration scrape complete — fetched={total_reg_fetched} "
        f"found_registered_row={total_reg_found} errors={total_reg_errors}"
    )
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
