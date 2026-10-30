# ===========================================================================
# backend/app/services/vendor_master_scraper/scraper.py
#
# Nightly, fleet-wide list scrape of SmartPAL's Purchase > Vendor grid (Purchase/VendorMaster,
# "All" tab — confirmed live 2026-10-30 this shows ~1,098 vendor rows across the whole fleet, not
# scoped to any category). Feeds vendor_master_entries for the Vendor Management module's "Add DD
# Vendor" picker.
#
# Same approach as po_scraper.py (read that module's docstring for the full reasoning): one real
# UI interaction (navigate + click the "All" tab) captures a genuine, fully-authorized
# api/ServiceRouter/POST request/response pair — the exact magic tab code and custom headers this
# endpoint needs, which a hand-built request reliably gets wrong. NOTE: this has not yet been
# confirmed against a live capture session the way PR/PO's body shape was (see po_scraper.py's own
# confirmed-live callouts) — the first real run against settings.vendor_master_url should be
# watched closely and this module's pagination/body-shape assumptions adjusted if SmartPAL's
# VendorMaster grid behaves differently from the PR/PO grids it was modeled on.
#
# Deliberately does NOT scrape per-vendor detail (Vendor Contacts / Bank Details / attachments) —
# that's the on-demand detail_scraper.py, run only once a vendor is added to the tracker. This
# scraper must never write to the detail-scrape-only columns on VendorMasterEntry (address/
# phone_1/contacts/etc.) — confirmed with the user 2026-10-30 a full detail sweep of all ~1,098
# vendors nightly would be far too heavy on the shared SmartPAL login session.
# ===========================================================================
import logging
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.vendor_master_entry import VendorMasterEntry
from app.services.pir_scraper.generate_auth import run_automated_login

log = logging.getLogger(__name__)

_GRID_HEADER_KEYS = (
    "servicepath", "v_isallvessels", "app_code", "iscompanyfilteractive", "s_key",
    "x-requested-with", "v_coname", "v_coid", "v_objectid", "v_code", "v_cmpid", "v_id", "v_name",
)

_PAGE_SIZE = 2000

_FETCH_JS = """async ([body, hdrs]) => {
    const resp = await fetch(window.location.origin + '/PurchasePALApp/api/ServiceRouter/POST', {
        method: 'POST',
        headers: Object.assign({'Content-Type': 'application/json;charset=UTF-8'}, hdrs),
        credentials: 'include',
        body: JSON.stringify(body),
    });
    const text = await resp.text();
    return {status: resp.status, text: text};
}"""


def _bool_yn(v) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().upper()
    if s == "Y":
        return True
    if s == "N":
        return False
    return None


def _capture_grid_request(page, url: str) -> tuple[dict, dict] | None:
    """Navigates to the grid page and clicks its real "All" tab, capturing the genuine
    headers + body of the resulting gridServerOperations POST — see module docstring."""
    captured: dict = {}

    def on_request(req):
        if req.method == "POST" and "ServiceRouter/POST" in req.url and "gridServerOperations" in (req.post_data or ""):
            captured["headers"] = req.headers
            captured["body"] = req.post_data

    page.on("request", on_request)
    page.goto(url, wait_until="load", timeout=60000)
    page.wait_for_timeout(3000)

    if "login" in page.url.lower() or "SIGN IN" in (page.content() or ""):
        page.remove_listener("request", on_request)
        raise RuntimeError("Session expired / not authenticated — SmartPAL bounced to the login page.")

    try:
        page.locator("text=/^All$/").first.click(timeout=10000)
    except Exception as e:
        log.warning(f"[CLICK]    Could not click the 'All' tab on {url}: {e}")
    page.wait_for_timeout(4000)
    page.remove_listener("request", on_request)

    if "body" not in captured:
        return None

    import json as _json

    return captured["headers"], _json.loads(captured["body"])


def _fetch_all_rows(page, url: str) -> list[dict]:
    import json as _json

    captured = _capture_grid_request(page, url)
    if captured is None:
        raise RuntimeError(f"No gridServerOperations request captured for {url} — page may have changed.")
    headers, body = captured
    hdrs = {k: v for k, v in headers.items() if k in _GRID_HEADER_KEYS}

    rows: list[dict] = []
    page_num = 1
    while True:
        body["gridServerOperations"] = {"filters": None, "page": page_num, "pageSize": _PAGE_SIZE}
        result = page.evaluate(_FETCH_JS, [body, hdrs])
        if result["status"] != 200:
            raise RuntimeError(f"Grid fetch failed (page {page_num}, status {result['status']}): {result['text'][:300]}")
        parsed = _json.loads(result["text"])
        # Confirmed live 2026-10-30: unlike PR/PO's grids (a bare JSON array per page), the Vendor
        # Master grid wraps its rows in an envelope — {"version", "statusCode", "result": [...]}.
        # Fall back to treating the body itself as the row list if some future response doesn't
        # have this wrapper.
        batch = parsed.get("result") if isinstance(parsed, dict) else parsed
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected grid response shape (page {page_num}): {result['text'][:300]}")
        rows.extend(batch)
        # totalCount isn't present in this envelope the way it is on PR/PO's per-row totalCount —
        # rely on page-size short-circuiting instead (a page with fewer rows than pageSize is the
        # last one), same safety net PR/PO's own loop already falls back to when totalCount is 0.
        total_count = batch[0].get("totalCount", 0) if batch else 0
        if len(batch) < _PAGE_SIZE or (total_count and len(rows) >= total_count):
            break
        page_num += 1

    return rows


def _run(page, db) -> dict:
    rows = _fetch_all_rows(page, settings.vendor_master_url)
    log.info(f"[VENDOR]   {len(rows)} vendor row(s) returned.")

    inserted = updated = skipped = errors = 0
    for r in rows:
        vendor_code = (r.get("code") or "").strip() or None
        if not vendor_code:
            skipped += 1
            continue

        values = {
            "vendor_name": r.get("company") or r.get("name"),
            "vendor_type": r.get("type"),
            "email": r.get("email"),
            "currency": r.get("currency"),
            "city": r.get("city"),
            "country": r.get("country") or r.get("vendorCountry"),
            "state": r.get("state"),
            "active": _bool_yn(r.get("active")) if not isinstance(r.get("active"), bool) else r.get("active"),
            "raw_json": r,
        }

        try:
            existing = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == vendor_code).first()
            now = datetime.now(timezone.utc)
            if existing:
                for field, value in values.items():
                    setattr(existing, field, value)
                existing.last_scraped_at = now
                updated += 1
            else:
                db.add(VendorMasterEntry(vendor_code=vendor_code, last_scraped_at=now, **values))
                inserted += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors += 1
            log.error(f"[SAVE]     Failed to upsert vendor {vendor_code!r}: {e}")

    return {"inserted": inserted, "updated": updated, "skipped": skipped, "errors": errors}


def run() -> None:
    if not MARIAPPS_AUTH_JSON.exists():
        log.info("[AUTH]     No saved session found — running automated login first.")
        run_automated_login()

    db = SessionLocal()
    counters = None
    try:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                counters = _run(context.new_page(), db)
                browser.close()
        except RuntimeError as e:
            if "expired" not in str(e).lower() and "not authenticated" not in str(e).lower():
                raise
            log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
            run_automated_login()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                counters = _run(context.new_page(), db)
                browser.close()
    finally:
        db.close()

    log.info("=" * 60)
    log.info(f"  Vendor Master scrape complete — {counters}")
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
