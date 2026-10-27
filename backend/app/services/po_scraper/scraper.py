# ===========================================================================
# backend/app/services/po_scraper/scraper.py
#
# Scrapes SmartPAL's Purchase Requisition grid (Purchase/RequisitionApproval) and Purchase Order
# grid (Purchase/POOverview), feeding pr_entries / po_entries for the DD Tracker module.
#
# Reuses pir_scraper's login session (MARIAPPS_AUTH_JSON / run_automated_login) — same SSO
# account, same convention smartpal_invoice_scraper already uses for a different scraper's auth.
#
# APPROACH (confirmed live 2026-10-27): these two grids are server-paged Kendo grids, unlike
# PIR's virtual-scroll one. A real UI interaction (navigate + click the "All" tab) is done ONCE
# per grid to get a genuine, fully-authorized api/ServiceRouter/POST request/response pair — this
# captures both the magic per-grid tab code (PR's "All" tab POSTs status="ALL"; PO's POSTs
# approvalFlag="8" — neither is a stable/documented value, just whatever a live click produces)
# and the exact custom headers (servicepath/v_coid/s_key/etc.) the endpoint requires, which a
# hand-built request reliably gets wrong (confirmed live: a guessed header set 500s even with an
# otherwise-correct body). Every subsequent page is then fetched via a plain in-page `fetch()`
# reusing those exact headers with only `gridServerOperations.page`/`fromDate` changed — confirmed
# live this is reliable and far faster than clicking through the grid's own pager one page at a
# time. pageSize is set high (2000) so most date ranges complete in 1-2 requests per grid.
#
# CONFIRMED DEAD END: PO's request body carries an `isShowDrydoksPO` boolean that looks
# purpose-built for scoping to dry-dock POs, but toggling it live changed nothing (identical
# totalCount both ways) — so this scraper does NOT use it. Per the user's own instruction, scope
# is intentionally NOT narrowed to dry-dock items at all: every PR/PO from FROM_DATE onward is
# scraped, across the whole fleet; filtering to dry-dock-relevant rows happens inside this app
# (DD Tracker UI), not at scrape time. The only exclusion applied here is category-based: the 11
# crew categories below are skipped entirely, confirmed with the user as never relevant to this app.
# ===========================================================================
import logging
import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.services.pir_scraper.generate_auth import run_automated_login

log = logging.getLogger(__name__)

FROM_DATE = date(2026, 7, 1)

# Confirmed with the user 2026-10-27 — these 11 categories (crew wages/expenses, across NB/PD/DD/
# OPEX variants) are never relevant to this app and are skipped at scrape time. Matched after
# normalizing whitespace around "-" since SmartPAL's own category strings aren't consistent about
# it (e.g. PR rows show "OPEX - REPAIR", PO rows show "OPEX-OTHERS").
_EXCLUDED_CATEGORIES_RAW = {
    "CREWING",
    "CREW WAGES",
    "CREW EXPENSES",
    "NB - CREW EXPENSES",
    "NB - CREW WAGES",
    "PD - CREW EXPENSES",
    "PD - CREW WAGES",
    "DD - CREW EXPENSES",
    "DD - CREW WAGES",
    "OPEX - CREW EXPENSES",
    "OPEX - CREW WAGES",
}


def _normalize_category(value: str | None) -> str | None:
    if not value:
        return None
    collapsed = re.sub(r"\s*-\s*", " - ", value.strip().upper())
    return re.sub(r"\s+", " ", collapsed)


_EXCLUDED_CATEGORIES = {_normalize_category(c) for c in _EXCLUDED_CATEGORIES_RAW}

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


def _to_smartpal_date(d: date) -> str:
    return d.strftime("%d-%b-%Y")


def _num(v) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except InvalidOperation:
        return None


def _parse_date(v) -> date | None:
    if not v:
        return None
    try:
        parsed = datetime.fromisoformat(str(v))
    except ValueError:
        return None
    if parsed.year <= 1:
        return None  # SmartPAL's own "unset date" sentinel (e.g. "0001-01-01T00:00:00")
    return parsed.date()


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
    headers + body of the resulting gridServerOperations POST — see module docstring for why a
    hand-built request isn't reliable here. Returns (headers, body) or None if nothing was
    captured (e.g. session expired, bounced to a login/error page)."""
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


def _fetch_all_rows(page, url: str, to_date: date) -> list[dict]:
    """Captures a real request/response for the grid's "All" tab, then pages through the rest
    (if any) by replaying the exact same headers with only gridServerOperations.page/fromDate/
    toDate changed — see module docstring."""
    import json as _json

    captured = _capture_grid_request(page, url)
    if captured is None:
        raise RuntimeError(f"No gridServerOperations request captured for {url} — page may have changed.")
    headers, body = captured
    hdrs = {k: v for k, v in headers.items() if k in _GRID_HEADER_KEYS}

    body["fromDate"] = _to_smartpal_date(FROM_DATE)
    body["toDate"] = _to_smartpal_date(to_date)

    rows: list[dict] = []
    page_num = 1
    while True:
        body["gridServerOperations"] = {"filters": None, "page": page_num, "pageSize": _PAGE_SIZE}
        result = page.evaluate(_FETCH_JS, [body, hdrs])
        if result["status"] != 200:
            raise RuntimeError(f"Grid fetch failed (page {page_num}, status {result['status']}): {result['text'][:300]}")
        batch = _json.loads(result["text"])
        if not isinstance(batch, list):
            raise RuntimeError(f"Unexpected grid response shape (page {page_num}): {result['text'][:300]}")
        rows.extend(batch)
        total_count = batch[0]["totalCount"] if batch else 0
        if len(batch) < _PAGE_SIZE or len(rows) >= total_count:
            break
        page_num += 1

    return rows


def _run_pr(page, db) -> dict:
    rows = _fetch_all_rows(page, settings.requisition_approval_url, date.today())
    log.info(f"[PR]       {len(rows)} requisition row(s) returned.")

    inserted = updated = skipped = errors = 0
    for r in rows:
        requisition_no = (r.get("code") or "").strip() or None
        if not requisition_no:
            continue
        category_norm = _normalize_category(r.get("reqCategory"))
        if category_norm in _EXCLUDED_CATEGORIES:
            skipped += 1
            continue

        values = {
            "smartpal_id": r.get("id"),
            "title": r.get("title"),
            "vessel_name": r.get("vesselName"),
            "req_category": r.get("reqCategory"),
            "department": r.get("department"),
            "status": r.get("status"),
            "priority": r.get("priority"),
            "critical": _bool_yn(r.get("critical")),
            "created_by": r.get("createdBy"),
            "created_date": _parse_date(r.get("createdDate")),
            "approved_date": _parse_date(r.get("approvedDate")),
            "received_date": _parse_date(r.get("receivedDate")),
            "pending_since": r.get("pendingSince"),
            "item_count": r.get("itemCount"),
            "required_before": _parse_date(r.get("requiredBefore")),
            "raw_json": r,
        }

        try:
            existing = db.query(PrEntry).filter(PrEntry.requisition_no == requisition_no).first()
            now = datetime.now(timezone.utc)
            if existing:
                for field, value in values.items():
                    setattr(existing, field, value)
                existing.last_scraped_at = now
                updated += 1
            else:
                db.add(PrEntry(requisition_no=requisition_no, last_scraped_at=now, **values))
                inserted += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors += 1
            log.error(f"[PR SAVE]  Failed to upsert requisition {requisition_no!r}: {e}")

    return {"inserted": inserted, "updated": updated, "skipped": skipped, "errors": errors}


def _run_po(page, db) -> dict:
    rows = _fetch_all_rows(page, settings.po_overview_url, date.today())
    log.info(f"[PO]       {len(rows)} PO row(s) returned.")

    inserted = updated = skipped = errors = 0
    for r in rows:
        po_no = (r.get("poNo") or "").strip() or None
        if not po_no:
            continue
        category_norm = _normalize_category(r.get("reqCategory"))
        if category_norm in _EXCLUDED_CATEGORIES:
            skipped += 1
            continue

        requisition_no = (r.get("reqNo") or "").strip() or None
        if not requisition_no and r.get("reqNos"):
            requisition_no = str(r["reqNos"]).split(",")[0].strip() or None

        values = {
            "smartpal_id": r.get("id"),
            "requisition_no": requisition_no,
            "title": r.get("title"),
            "vessel_name": r.get("vessel"),
            "vendor": r.get("vendor"),
            "req_category": r.get("reqCategory"),
            "po_type": r.get("poType"),
            "base_amount": _num(r.get("pO_Amount")),
            "base_currency": r.get("baseCurrency"),
            "approved_status": r.get("approvedStatus"),
            "invoice_status": r.get("invoiceStatus"),
            "po_sent": _bool_yn(r.get("poSent")) if not isinstance(r.get("poSent"), bool) else r.get("poSent"),
            "created_date": _parse_date(r.get("createdDate")),
            "approved_date": _parse_date(r.get("approvedDate")),
            "confirmed_date": _parse_date(r.get("confirmedDate")),
            "schd_del_port": r.get("schd_Del_port"),
            "agent_name": r.get("agentName"),
            "warehouse_name": r.get("warehouseName"),
            "grn_nos": r.get("grnNos"),
            "do_nos": r.get("doNos"),
            "remarks": r.get("remarks"),
            "pending_days": r.get("pendingDays"),
            "priority": r.get("priority"),
            "critical": _bool_yn(r.get("critical")),
            "raw_json": r,
        }

        try:
            existing = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
            now = datetime.now(timezone.utc)
            if existing:
                for field, value in values.items():
                    setattr(existing, field, value)
                existing.last_scraped_at = now
                updated += 1
            else:
                db.add(PoEntry(po_no=po_no, last_scraped_at=now, **values))
                inserted += 1
            db.commit()
        except Exception as e:
            db.rollback()
            errors += 1
            log.error(f"[PO SAVE]  Failed to upsert PO {po_no!r}: {e}")

    return {"inserted": inserted, "updated": updated, "skipped": skipped, "errors": errors}


def run() -> None:
    if not MARIAPPS_AUTH_JSON.exists():
        log.info("[AUTH]     No saved session found — running automated login first.")
        run_automated_login()

    db = SessionLocal()
    pr_counters = po_counters = None
    try:
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                pr_counters = _run_pr(context.new_page(), db)
                po_counters = _run_po(context.new_page(), db)
                browser.close()
        except RuntimeError as e:
            if "expired" not in str(e).lower() and "not authenticated" not in str(e).lower():
                raise
            log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
            run_automated_login()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                pr_counters = _run_pr(context.new_page(), db)
                po_counters = _run_po(context.new_page(), db)
                browser.close()
    finally:
        db.close()

    log.info("=" * 60)
    log.info(f"  PR scrape complete — {pr_counters}")
    log.info(f"  PO scrape complete — {po_counters}")
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
