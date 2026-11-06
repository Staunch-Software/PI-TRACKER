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
from sqlalchemy.orm import Session

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.dd_tracker_entry import DdTrackerEntry
from app.models.po_entry import PoEntry
from app.models.po_item_entry import PoItemEntry
from app.models.pr_entry import PrEntry
import urllib.parse
import json as _json
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
            "approval_flag": r.get("approvalflag"),
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
            "expected_delivery_date": _parse_date(r.get("schd_Del_Date")),
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


def _is_dd_category(category: str | None) -> bool:
    """True for any req_category under the "DD" umbrella (e.g. "DD - SPARE", "DD - DECK STORE",
    "DD- CARGO HOLD..." before normalization) — the user's own instruction: every DD-category
    PR/PO should show up in the DD Tracker automatically, not just a manually hand-picked subset.
    The crew-category DD variants (DD - CREW WAGES / DD - CREW EXPENSES) never reach this check at
    all — they're dropped at scrape time in _run_pr/_run_po, see _EXCLUDED_CATEGORIES above."""
    norm = _normalize_category(category)
    return bool(norm) and norm.startswith("DD")


# Matches "DD - ...", "DD- ...", "DD ..." or a bare "DD" title, case-insensitive, with a word
# boundary right after "DD" so an unrelated title that merely starts with those two letters (e.g.
# a vendor/item name) isn't swept in.
_DD_TITLE_RE = re.compile(r"^DD(\s|-|$)", re.IGNORECASE)


def _is_dd_title(title: str | None) -> bool:
    """True when the PR/PO's own free-text title is DD-prefixed even though SmartPAL's own
    req_category says something else (e.g. "OPEX-OTHERS", "ADHOC SPARES") — confirmed with the
    user 2026-11-04: purchase sometimes places what is really a DD order under a different
    category, but still prefixes the title with "DD" by convention. Catching that here means the
    DD Tracker picks these up automatically on every scrape, the same way a one-off manual
    backfill had to for GCL TAPI/GCL Yamuna before this existed (see git history around
    2026-11-03) — no more hand-linking via "Add Entry" needed for this specific pattern."""
    if not title:
        return False
    return bool(_DD_TITLE_RE.match(title.strip()))


def _sync_dd_tracker_entries(db: Session) -> dict:
    """Auto-populates dd_tracker_entries for every DD PR/PO the scraper just saw — confirmed with
    the user 2026-10-28: DD Tracker rows must appear automatically based on category, not be
    hand-created one at a time. A PR/PO counts as DD when EITHER its req_category is DD-flavored
    (_is_dd_category) OR its own title is DD-prefixed (_is_dd_title) even under some other
    category — the latter added 2026-11-04 to also catch DD orders purchase placed under e.g.
    OPEX by category but still titled "DD - ...", the same gap a one-off manual backfill had to
    cover for GCL TAPI/GCL Yamuna before this existed. Runs after _run_pr/_run_po on every scrape.

    PR-driven: any pr_entries row matching either signal and not already tracked (matched by
    requisition_no) gets a new dd_tracker_entries row, pulling in its matching PO (by
    po_entries.requisition_no) if one already exists.

    PO-driven (orphan Direct POs): a matching PO with no requisition_no (SmartPAL's own "Direct
    PO" case, see po_entry.py docstring) is tracked by po_no instead, since there's no PR to key
    off of.

    Existing dd_tracker_entries rows are NEVER overwritten here — this only fills in po_no on an
    already-tracked PR row when it was previously missing (a PO created after the PR was first
    synced), and only when that field is still null, so it can never clobber a manual edit."""
    inserted = linked = 0

    tracked_req_nos = {r[0] for r in db.query(DdTrackerEntry.requisition_no).filter(DdTrackerEntry.requisition_no.isnot(None)).all()}
    tracked_po_nos = {r[0] for r in db.query(DdTrackerEntry.po_no).filter(DdTrackerEntry.po_no.isnot(None)).all()}

    for pr in db.query(PrEntry).all():
        if not (_is_dd_category(pr.req_category) or _is_dd_title(pr.title)):
            continue
        if pr.requisition_no in tracked_req_nos:
            continue
        matching_po = db.query(PoEntry).filter(PoEntry.requisition_no == pr.requisition_no).first()
        db.add(
            DdTrackerEntry(
                entry_type="DD",
                requisition_no=pr.requisition_no,
                po_no=matching_po.po_no if matching_po else None,
                vessel_name=pr.vessel_name,
                title=pr.title,
            )
        )
        tracked_req_nos.add(pr.requisition_no)
        inserted += 1

    dd_direct_pos = db.query(PoEntry).filter(PoEntry.requisition_no.is_(None)).all()
    for po in dd_direct_pos:
        if not (_is_dd_category(po.req_category) or _is_dd_title(po.title)):
            continue
        if po.po_no in tracked_po_nos:
            continue
        db.add(
            DdTrackerEntry(
                entry_type="DD",
                requisition_no=None,
                po_no=po.po_no,
                vessel_name=po.vessel_name,
                title=po.title,
            )
        )
        tracked_po_nos.add(po.po_no)
        inserted += 1

    # Backfill po_no on already-tracked PR rows that didn't have a matching PO yet last time —
    # only when still null, never overwriting a manual edit.
    unlinked = db.query(DdTrackerEntry).filter(DdTrackerEntry.requisition_no.isnot(None), DdTrackerEntry.po_no.is_(None)).all()
    for entry in unlinked:
        matching_po = db.query(PoEntry).filter(PoEntry.requisition_no == entry.requisition_no).first()
        if matching_po:
            entry.po_no = matching_po.po_no
            linked += 1

    db.commit()
    return {"inserted": inserted, "linked": linked}


_FETCH_PO_ITEMS_JS = """async ({ pData, poHdId }) => {
    const origin = window.location.origin;
    const itemsUrl = origin + '/PurchasePALApp/api/ServiceRouter/GET?pData=' + pData;
    const r1 = await fetch(itemsUrl, {
        headers: {'servicepath': 'Purchase/POCreation/GetPOItems', 'app_code': 'SPS', 'x-requested-with': 'XMLHttpRequest'},
        credentials: 'include'
    });
    const t1 = await r1.text();

    const addUrl = origin + '/PurchasePALApp/api/ServiceRouter/GET?pData=' + encodeURIComponent(`PoHdId=${poHdId}&RevisionNo=0&CopyPo=N&selectedCategoryIdForCopyPo=0`);
    const r2 = await fetch(addUrl, {
        headers: {'servicepath': 'Purchase/poCreation/GetPoAddAmountDetails', 'app_code': 'SPS', 'x-requested-with': 'XMLHttpRequest'},
        credentials: 'include'
    });
    const t2 = await r2.text();

    return { itemsText: t1, addText: t2, status1: r1.status, status2: r2.status };
}"""


def _sync_dd_po_items(page, db: Session, target_po_nos: list[str] | None = None, force: bool = False) -> dict:
    """Scrapes line items and additional amounts from SmartPAL's POCreation page for DD POs.
    On first run or scheduled runs, processes DD POs.
    If target_po_nos is provided, restricts to those specific POs.
    If force is False, only scrapes POs not already present in po_item_entries.
    """
    if target_po_nos is not None:
        po_query = (
            db.query(DdTrackerEntry.po_no, DdTrackerEntry.vessel_name)
            .filter(DdTrackerEntry.po_no.in_(target_po_nos))
            .distinct()
            .all()
        )
    else:
        po_query = (
            db.query(DdTrackerEntry.po_no, DdTrackerEntry.vessel_name)
            .filter(DdTrackerEntry.po_no.isnot(None), DdTrackerEntry.deleted_at.is_(None))
            .distinct()
            .all()
        )

    if not force and target_po_nos is None:
        already_scraped = {r[0] for r in db.query(PoItemEntry.po_no).distinct().all()}
        po_query = [p for p in po_query if p[0] not in already_scraped]

    log.info(f"[PO ITEMS] {len(po_query)} DD PO(s) to scrape for item details.")
    scraped_pos = total_items = total_adds = errors = 0

    for po_no, vessel_name in po_query:
        po = db.query(PoEntry).filter(PoEntry.po_no == po_no).first()
        if not po or not po.smartpal_id:
            log.warning(f"[PO ITEMS] PO entry missing or no smartpal_id for {po_no}")
            continue

        po_hd_id = po.smartpal_id
        vessel_obj_id = po.raw_json.get("vesselObjectId", 0) if po.raw_json else 0
        p_data = urllib.parse.quote(
            f"vesselObjectId={vessel_obj_id}&poHdId={po_hd_id}&isCopy=false&revisionNo=0&selectedCategoryIdForCopyPo=0"
        )

        try:
            res = page.evaluate(_FETCH_PO_ITEMS_JS, {"pData": p_data, "poHdId": po_hd_id})
            items_data = []
            add_data = []

            try:
                items_json = _json.loads(res["itemsText"])
                items_data = items_json.get("poDetEntity", []) or []
            except Exception as e:
                log.warning(f"[PO ITEMS] Could not parse items JSON for {po_no}: {e}")

            try:
                add_json = _json.loads(res["addText"])
                add_data = add_json.get("result", []) or []
            except Exception as e:
                log.warning(f"[PO ITEMS] Could not parse add amounts JSON for {po_no}: {e}")

            # Remove previous rows for this po_no to avoid duplicates
            db.query(PoItemEntry).filter(PoItemEntry.po_no == po_no).delete()

            now = datetime.now(timezone.utc)
            resolved_vessel = po.vessel_name or vessel_name

            for item in items_data:
                acct_code = (item.get("accountCode") or "").strip()
                acct_name = (item.get("accountName") or "").strip()
                full_acct = f"{acct_code} - {acct_name}" if acct_code and acct_name else (acct_code or "Uncategorized")

                db.add(
                    PoItemEntry(
                        smartpal_po_id=po_hd_id,
                        po_no=po_no,
                        vessel_name=resolved_vessel,
                        item_type="ITEM",
                        account_code=full_acct,
                        account_code_desc=acct_name or None,
                        part_number=(str(item.get("partNumber")).strip() or None) if item.get("partNumber") is not None else None,
                        item_description=item.get("itemDescription"),
                        rob=_num(item.get("robQuantity")),
                        unit_price=_num(item.get("unitPrice")),
                        quantity=_num(item.get("quantity")),
                        discount_pct=_num(item.get("discountPercentage")),
                        total_amount_inr=_num(item.get("totalPoCurrency")),
                        total_amount_usd=_num(item.get("totalVesselCurrency")),
                        sub_account_code=item.get("subAccountCode"),
                        analysis_code=item.get("analysisCode"),
                        client_code=item.get("clientCode"),
                        drawing_no=item.get("drawingNo") or item.get("drawingNumber"),
                        raw_json=item,
                        first_scraped_at=now,
                        last_scraped_at=now,
                    )
                )
                total_items += 1

            for add in add_data:
                acct_code = (add.get("accountCode") or "").strip()
                acct_name = (add.get("accountName") or "").strip()
                full_acct = f"{acct_code} - {acct_name}" if acct_code and acct_name else (acct_code or "Uncategorized")
                desc = add.get("additionalAmtDesc") or add.get("description") or "Additional Amount"

                db.add(
                    PoItemEntry(
                        smartpal_po_id=po_hd_id,
                        po_no=po_no,
                        vessel_name=resolved_vessel,
                        item_type="ADDITIONAL",
                        account_code=full_acct,
                        account_code_desc=acct_name or None,
                        part_number=None,
                        item_description=desc,
                        rob=None,
                        unit_price=_num(add.get("amount")),
                        quantity=Decimal(1),
                        discount_pct=_num(add.get("discountPercentage")),
                        total_amount_inr=_num(add.get("netAmount")),
                        total_amount_usd=_num(add.get("netAmountVsl")),
                        vat_key=add.get("vatKeyName"),
                        vat_pct=_num(add.get("vatPercentage")),
                        sub_account_code=add.get("subAccountCode"),
                        analysis_code=add.get("analysisCode"),
                        client_code=add.get("clientCode"),
                        drawing_no=None,
                        raw_json=add,
                        first_scraped_at=now,
                        last_scraped_at=now,
                    )
                )
                total_adds += 1

            db.commit()
            scraped_pos += 1
        except Exception as e:
            db.rollback()
            errors += 1
            log.error(f"[PO ITEMS] Failed scraping items for {po_no}: {e}")

    return {"scraped_pos": scraped_pos, "items": total_items, "add_amounts": total_adds, "errors": errors}


def scrape_dd_po_items(target_po_nos: list[str] | None = None, force: bool = False) -> dict:
    """Entrypoint to scrape item details for DD POs on-demand or as part of a background task.
    If target_po_nos is None and force is False, only scrapes newly added DD POs that do not
    yet exist in po_item_entries. If no new POs exist, returns immediately without launching browser.
    """
    db = SessionLocal()
    try:
        if target_po_nos is not None:
            needed_pos = target_po_nos
        else:
            all_dd_pos = [
                r[0]
                for r in db.query(DdTrackerEntry.po_no)
                .filter(DdTrackerEntry.po_no.isnot(None), DdTrackerEntry.deleted_at.is_(None))
                .distinct()
                .all()
            ]
            if not force:
                already_scraped = {r[0] for r in db.query(PoItemEntry.po_no).distinct().all()}
                needed_pos = [p for p in all_dd_pos if p not in already_scraped]
            else:
                needed_pos = all_dd_pos

        if not needed_pos:
            log.info("[PO ITEMS] All DD PO items already up to date. No new POs to scrape.")
            return {
                "scraped_pos": 0,
                "items": 0,
                "add_amounts": 0,
                "errors": 0,
                "message": "All DD PO items are already up to date. No new POs found."
            }

        log.info(f"[PO ITEMS] Scraping item details for {len(needed_pos)} new DD PO(s): {needed_pos}")

        if not MARIAPPS_AUTH_JSON.exists():
            log.info("[AUTH]     No saved session found — running automated login first.")
            run_automated_login()

        result = {}
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000})
                page = context.new_page()
                page.goto(settings.po_overview_url, wait_until="load", timeout=60000)
                page.wait_for_timeout(3000)
                if "login" in page.url.lower() or "SIGN IN" in (page.content() or ""):
                    raise RuntimeError("Session expired / not authenticated")
                result = _sync_dd_po_items(page, db, target_po_nos=needed_pos, force=True)
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
                page.goto(settings.po_overview_url, wait_until="load", timeout=60000)
                page.wait_for_timeout(3000)
                result = _sync_dd_po_items(page, db, target_po_nos=needed_pos, force=True)
                browser.close()
        return result
    finally:
        db.close()


def run() -> None:
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

        dd_sync_counters = _sync_dd_tracker_entries(db)
    finally:
        db.close()

    # Scrape PO items for DD POs (isolated so any item scrape issue never affects PR/PO completion)
    po_items_counters = {}
    try:
        po_items_counters = scrape_dd_po_items()
    except Exception as e:
        log.error(f"[PO ITEMS] Background DD PO items scrape encountered error: {e}")
        po_items_counters = {"error": str(e)}

    log.info("=" * 60)
    log.info(f"  PR scrape complete — {pr_counters}")
    log.info(f"  PO scrape complete — {po_counters}")
    log.info(f"  DD Tracker auto-sync complete — {dd_sync_counters}")
    log.info(f"  DD PO Items scrape complete — {po_items_counters}")
    log.info("=" * 60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run()
