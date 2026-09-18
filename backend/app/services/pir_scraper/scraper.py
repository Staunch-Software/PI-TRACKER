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
# ===========================================================================
import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.pir_entry import PirEntry
from app.services.vendor_mapping_importer import normalize_vendor_name
from .generate_auth import run_automated_login

log = logging.getLogger(__name__)

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


def run() -> None:
    if not MARIAPPS_AUTH_JSON.exists():
        log.info("[AUTH]     No saved session found — running automated login first.")
        run_automated_login()

    db = SessionLocal()
    inserted = updated = errors = 0

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=settings.mariapps_headless)
            context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
            page = context.new_page()

            try:
                rows = _fetch_rows(page)
            except RuntimeError as e:
                if "expired" in str(e).lower() or "not authenticated" in str(e).lower():
                    log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
                    browser.close()
                    run_automated_login()
                    browser = p.chromium.launch(headless=settings.mariapps_headless)
                    context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                    page = context.new_page()
                    rows = _fetch_rows(page)
                else:
                    raise

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
                    updated += 1
                else:
                    db.add(PirEntry(smartpal_invoice_id=smartpal_id, last_scraped_at=now, **values))
                    inserted += 1
                db.commit()
            except Exception as e:
                db.rollback()
                errors += 1
                log.error(f"[SAVE]     Failed to upsert PIR invoice id={smartpal_id}: {e}")

    finally:
        db.close()

    log.info("=" * 60)
    log.info(f"  PIR scrape complete — inserted={inserted} updated={updated} errors={errors}")
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
