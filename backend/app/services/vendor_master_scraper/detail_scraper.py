# ===========================================================================
# backend/app/services/vendor_master_scraper/detail_scraper.py
#
# On-demand detail scrape for ONE vendor — runs only when a vendor is added to the Vendor
# Management tracker (or "Refresh from SmartPAL" is clicked), never proactively for all ~1,098
# vendors (see scraper.py's module docstring for why). Pulls the "Vendor Contacts" tab (address/
# phone/contacts sub-grid), the "Bank Details" tab (one or more bank rows), and the vendor's
# attachment list (downloading each new file into our own Azure Blob storage).
#
# Runs as a FastAPI BackgroundTask (see api/routes/vendor_management.py) — opens its own
# SessionLocal() since background tasks execute outside the request's DB session, same as
# po_scraper.run()/scraper.run() already do when invoked standalone.
#
# NOTE: unlike po_scraper.py's PR/PO grid bodies (confirmed live 2026-10-27), the exact UI flow
# for reaching a single vendor's detail page/tabs has not yet been confirmed against a live
# SmartPAL session — this drives the page by visible text (the vendor's own Code filter field,
# tab labels, the paperclip icon) rather than a guessed API shape, matching this app's established
# "real click over hand-built request" caution. Watch the first real run's logs closely and adjust
# selectors if SmartPAL's actual DOM differs from what's assumed here.
# ===========================================================================
import logging
from datetime import date, datetime, timezone

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings
from app.db.session import SessionLocal
from app.models.vendor_bank_detail import VendorBankDetail
from app.models.vendor_master_attachment import VendorMasterAttachment
from app.models.vendor_master_entry import VendorMasterEntry
from app.services.blob_storage import upload_bytes_to_blob
from app.services.pir_scraper.generate_auth import run_automated_login

log = logging.getLogger(__name__)


def _open_vendor(page, vendor_code: str) -> bool:
    """Navigates to the vendor grid, filters by Code, and opens the matching vendor's detail
    page. Returns False if the vendor couldn't be found/opened."""
    page.goto(settings.vendor_master_url, wait_until="load", timeout=60000)
    page.wait_for_timeout(2000)

    if "login" in page.url.lower() or "SIGN IN" in (page.content() or ""):
        raise RuntimeError("Session expired / not authenticated — SmartPAL bounced to the login page.")

    code_field = page.locator("input").filter(has=page.locator("xpath=preceding-sibling::label[text()='Code']")).first
    try:
        page.get_by_label("Code").fill(vendor_code, timeout=5000)
    except Exception:
        try:
            code_field.fill(vendor_code, timeout=5000)
        except Exception as e:
            log.warning(f"[VENDOR]   Could not find the Code filter field: {e}")

    try:
        page.locator("button[title='Search'], .search-icon, button:has-text('Search')").first.click(timeout=5000)
    except Exception:
        page.keyboard.press("Enter")
    page.wait_for_timeout(2000)

    try:
        page.locator(f"a:has-text('{vendor_code}')").first.click(timeout=10000)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open vendor {vendor_code!r} from the grid: {e}")
        return False

    page.wait_for_timeout(2000)
    return True


# Confirmed live 2026-10-30 (DOM inspection of the Vendor Contacts tab): this is a Knockout.js
# app — each field is a <textarea>/<input>/<select> with a `data-bind="value:vendorData.<prop>"`
# attribute, a sibling (not wrapping) <label> with no `for=` attribute. That means Playwright's
# label-based lookup (get_by_label) can never match these fields — reading by the stable
# data-bind property name is the reliable approach instead. Candidate property names below are
# best-effort guesses beyond the one confirmed field ("address"); any that don't match simply
# return None, same as today, so a wrong guess costs nothing.
_CONTACT_FIELD_CANDIDATES: dict[str, list[str]] = {
    "address": ["address"],
    "phone_1": ["phone1", "phoneNo1", "contactNo1", "phone_1"],
    "phone_2": ["phone2", "phoneNo2", "contactNo2", "phone_2"],
    "fax_1": ["fax1", "fax", "fax_1"],
    "fax_2": ["fax2", "fax_2"],
    "telex": ["telex"],
    "website": ["website", "webSite", "web_site"],
    "zip_code": ["zipCode", "zip", "pinCode", "postalCode"],
    "email": ["email"],
    "city": ["city"],
    "country": ["country"],
    "state": ["state"],
}

# Confirmed live 2026-10-30: each tab's content lives in a stable-id container
# (<div id="Vendor_Contacts" class="tab-pane ...">, <div id="Bank_Details" class="tab-pane ...">)
# — scoping every selector to these containers (instead of querying the whole page) is what fixes
# the "93 SmartPAL bank row(s)" bug, where an unscoped `table tbody tr` picked up rows from other
# tables/tabs elsewhere on the page.
_VENDOR_CONTACTS_TAB_ID = "#Vendor_Contacts"
_BANK_DETAILS_TAB_ID = "#Bank_Details"


def _databind_field_value(page, scope_selector: str, candidates: list[str]) -> str | None:
    for prop in candidates:
        try:
            el = page.locator(f'{scope_selector} [data-bind*="vendorData.{prop}"]').first
            if el.count() == 0:
                continue
            tag = el.evaluate("e => e.tagName.toLowerCase()")
            # A <select>'s input_value() returns the selected OPTION's VALUE (e.g. an internal
            # numeric country id like "58"), not its visible text ("China") — confirmed live
            # 2026-10-30 on the Country field. Read the selected option's own text instead.
            if tag == "select":
                value = el.evaluate("e => e.options[e.selectedIndex] ? e.options[e.selectedIndex].text : ''")
            else:
                value = el.input_value(timeout=1500)
            if value and value.strip():
                return value.strip()
        except Exception:
            continue
    return None


def _kendo_grid_data(page, scope_selector: str) -> list[dict] | None:
    """Reads a Kendo UI Grid's rows via its own `dataSource.data()` API — the exact bound row
    objects, not rendered table text. Confirmed live 2026-10-30 via DOM inspection: the Vendor
    Contacts sub-grid (#grdVendorContact) and Bank Details grid (#grdBankDetails) are both Kendo
    Grid widgets (`data-role="grid"`, `k-header` classes), NOT plain HTML tables — their rendered
    <td> cells include hidden/technical columns interleaved with the visible ones (confirmed: a
    bank-details row's visible cells came back completely misaligned when read by fixed cell
    index). Reading dataSource.data() sidesteps that misalignment entirely and returns real,
    correctly-typed field values — same spirit as this app's other scrapers preferring a captured
    real payload over parsing rendered output. Returns None (so callers can fall back to cell-text
    parsing) if no Kendo grid widget is found in the given scope."""
    try:
        data = page.evaluate(
            """(scope) => {
                const $ = typeof jQuery !== 'undefined' ? jQuery : window.$;
                if (!$) return null;
                const container = document.querySelector(scope);
                if (!container) return null;
                const gridEl = container.querySelector('[data-role="grid"]');
                if (!gridEl) return null;
                const kg = $(gridEl).data('kendoGrid');
                if (!kg) return null;
                return kg.dataSource.data().map(d => (d.toJSON ? d.toJSON() : d));
            }""",
            scope_selector,
        )
        return data if data else None
    except Exception:
        return None


def _row_value(row: dict, candidates: list[str]) -> str | None:
    """Case-insensitive lookup of the first matching, non-empty key among `candidates` in a Kendo
    row object — raw_json always keeps the full object regardless, so extra fallback candidates
    beyond the confirmed real property name cost nothing."""
    lower_map = {str(k).lower(): v for k, v in row.items()}
    for prop in candidates:
        value = lower_map.get(prop.lower())
        if value is None:
            continue
        text = str(value).strip()
        if text and text.lower() != "null":
            return text
    return None


def _scrape_contacts(page) -> dict:
    try:
        page.locator("text=Vendor Contacts").first.click(timeout=5000)
        page.wait_for_timeout(1500)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open Vendor Contacts tab: {e}")
        return {}

    # Confirmed live 2026-10-30 (Kendo dataSource dump, #grdVendorContact): real field names are
    # name, designation, email, mobile, landPhone (not "tel"), remarks,
    # defaultCorrespondence ("Y"/"N", not "isDefault").
    grid_contacts = _kendo_grid_data(page, _VENDOR_CONTACTS_TAB_ID)
    if grid_contacts:
        contacts = [
            {
                "name": _row_value(r, ["name", "contactName"]),
                "designation": _row_value(r, ["designation"]),
                "email": _row_value(r, ["email"]),
                "mobile": _row_value(r, ["mobile"]),
                "tel": _row_value(r, ["landPhone", "tel", "phoneHome"]),
                "is_default": _row_value(r, ["defaultCorrespondence"]) == "Y",
                "remarks": _row_value(r, ["remarks"]),
                "raw": r,
            }
            for r in grid_contacts
        ]
    else:
        contacts = []
        try:
            for row in page.locator(f"{_VENDOR_CONTACTS_TAB_ID} table tbody tr").all():
                cells = [c.strip() for c in row.locator("td").all_inner_texts()]
                if cells:
                    contacts.append({"raw_cells": cells})
        except Exception:
            pass

    fields = {
        field: _databind_field_value(page, _VENDOR_CONTACTS_TAB_ID, candidates)
        for field, candidates in _CONTACT_FIELD_CANDIDATES.items()
    }
    fields["contacts"] = contacts
    return fields


def _scrape_bank_details(page) -> list[dict]:
    try:
        page.locator("text=Bank Details").first.click(timeout=5000)
        page.wait_for_timeout(1500)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open Bank Details tab: {e}")
        return []

    # Confirmed live 2026-10-30 (Kendo dataSource dump, #grdBankDetails): real field names are
    # beneficiaryName, branchName, bankName, countryName (not "country"), bankCode,
    # currencyVal (not "currency"), accountNo (not "accountNumber"),
    # defaultAccount ("1"/"0", not "isDefault"), active ("Y"/"N"), iBan, swiftCode, aba (not "abaNo").
    grid_rows = _kendo_grid_data(page, _BANK_DETAILS_TAB_ID)
    if grid_rows:
        return [
            {
                "beneficiary_name": _row_value(r, ["beneficiaryName"]),
                "branch_name": _row_value(r, ["branchName"]),
                "bank_name": _row_value(r, ["bankName"]),
                "country": _row_value(r, ["countryName", "country"]),
                "bank_code": _row_value(r, ["bankCode"]),
                "currency": _row_value(r, ["currencyVal", "currency"]),
                "account_number": _row_value(r, ["accountNo", "accountNumber"]),
                "is_default": _row_value(r, ["defaultAccount"]) == "1",
                "is_active": _row_value(r, ["active"]) != "N",
                "iban": _row_value(r, ["iBan", "iban"]),
                "swift_code": _row_value(r, ["swiftCode"]),
                "aba_no": _row_value(r, ["aba", "abaNo"]),
                "raw": r,
            }
            for r in grid_rows
        ]

    # Fallback (no Kendo grid widget found for some reason): cell-text parsing. Deliberately does
    # NOT assume a fixed column order here — confirmed live 2026-10-30 this table's rendered <td>
    # cells include hidden/technical columns interleaved with the visible ones, so a fixed index
    # mapping silently reads the wrong cell for every field. Without the grid's own data source
    # available there is no reliable way to tell which cell is which, so only raw_cells is kept
    # for this path — every mapped field stays None rather than guessing wrong.
    rows: list[dict] = []
    try:
        for row in page.locator(f"{_BANK_DETAILS_TAB_ID} table tbody tr").all():
            cells = [c.strip() for c in row.locator("td").all_inner_texts()]
            if cells and any(cells):
                rows.append({"raw_cells": cells})
    except Exception as e:
        log.warning(f"[VENDOR]   Could not read Bank Details rows: {e}")

    return rows


def _scrape_attachments(page, vendor_code: str, existing_keys: set[tuple[str, int]]) -> list[dict]:
    new_attachments: list[dict] = []
    try:
        page.locator("button:has(svg), .attachment-icon, [title='Attachments']").first.click(timeout=5000)
        page.wait_for_timeout(1500)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open the attachment list: {e}")
        return new_attachments

    try:
        for row in page.locator("table tbody tr").all():
            cells = [c.strip() for c in row.locator("td").all_inner_texts()]
            if len(cells) < 3:
                continue
            file_name = cells[1] if len(cells) > 1 else cells[0]
            size_label = cells[2] if len(cells) > 2 else ""
            date_label = cells[3] if len(cells) > 3 else None
            uploaded_by = cells[4] if len(cells) > 4 else None

            try:
                with page.expect_download(timeout=15000) as download_info:
                    row.click()
                download = download_info.value
                path = download.path()
                if not path:
                    continue
                data = open(path, "rb").read()
            except Exception as e:
                log.warning(f"[VENDOR]   Could not download attachment {file_name!r} for {vendor_code}: {e}")
                continue

            key = (file_name, len(data))
            if key in existing_keys:
                continue

            new_attachments.append({
                "file_name": file_name,
                "size_bytes": len(data),
                "data": data,
                "smartpal_uploaded_by": uploaded_by,
                "smartpal_uploaded_at": date_label,
                "raw_cells": cells,
            })
    except Exception as e:
        log.warning(f"[VENDOR]   Could not read attachment list for {vendor_code}: {e}")

    return new_attachments


def _guess_content_type(file_name: str) -> str:
    lower = file_name.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith(".png"):
        return "image/png"
    return "application/octet-stream"


def scrape_vendor_detail(vendor_code: str) -> None:
    """Entry point called from api/routes/vendor_management.py via FastAPI BackgroundTasks — runs
    fire-and-forget after a vendor is added/refreshed, so the add-vendor request itself never
    blocks on this (10-30+ seconds depending on attachment count)."""
    if not MARIAPPS_AUTH_JSON.exists():
        run_automated_login()

    db = SessionLocal()
    try:
        master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == vendor_code).first()
        if not master:
            log.error(f"[VENDOR]   {vendor_code!r} not found in vendor_master_entries — aborting detail scrape.")
            return

        existing_keys = {
            (a.file_name, a.size_bytes)
            for a in db.query(VendorMasterAttachment).filter(VendorMasterAttachment.vendor_code == vendor_code).all()
        }

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000}, accept_downloads=True)
                page = context.new_page()
                if not _open_vendor(page, vendor_code):
                    browser.close()
                    return

                contact_fields = _scrape_contacts(page)
                bank_rows = _scrape_bank_details(page)
                new_attachments = _scrape_attachments(page, vendor_code, existing_keys)
                browser.close()
        except RuntimeError as e:
            if "expired" not in str(e).lower() and "not authenticated" not in str(e).lower():
                raise
            log.warning(f"[AUTH]     {e} Re-authenticating and retrying once.")
            run_automated_login()
            with sync_playwright() as p:
                browser = p.chromium.launch(headless=settings.mariapps_headless)
                context = browser.new_context(storage_state=str(MARIAPPS_AUTH_JSON), viewport={"width": 1600, "height": 1000}, accept_downloads=True)
                page = context.new_page()
                if not _open_vendor(page, vendor_code):
                    browser.close()
                    return
                contact_fields = _scrape_contacts(page)
                bank_rows = _scrape_bank_details(page)
                new_attachments = _scrape_attachments(page, vendor_code, existing_keys)
                browser.close()

        # Update only the detail-scrape columns — never touches the nightly list-scrape columns
        # beyond refining email/city/country/state if the detail page has a more complete value.
        for field in ("address", "phone_1", "phone_2", "fax_1", "fax_2", "telex", "website", "zip_code", "contacts"):
            if field in contact_fields and contact_fields[field]:
                setattr(master, field, contact_fields[field])
        for field in ("email", "city", "country", "state"):
            if contact_fields.get(field):
                setattr(master, field, contact_fields[field])
        master.detail_scraped_at = datetime.now(timezone.utc)

        # Bank details: pure read-only mirror — delete+reinsert per vendor_code on each scrape.
        db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == vendor_code).delete()
        for b in bank_rows:
            db.add(VendorBankDetail(
                vendor_code=vendor_code,
                beneficiary_name=b.get("beneficiary_name"),
                branch_name=b.get("branch_name"),
                bank_name=b.get("bank_name"),
                country=b.get("country"),
                bank_code=b.get("bank_code"),
                currency=b.get("currency"),
                account_number=b.get("account_number"),
                iban=b.get("iban"),
                swift_code=b.get("swift_code"),
                aba_no=b.get("aba_no"),
                is_default=bool(b.get("is_default")),
                is_active=bool(b.get("is_active")),
                raw_json=b,
            ))

        # Attachments: upload each new file's bytes to our own blob storage, then record it.
        for att in new_attachments:
            blob_key = f"vendor-attachments/{vendor_code}/{date.today().isoformat()}-{att['file_name']}"
            content_type = _guess_content_type(att["file_name"])
            try:
                upload_bytes_to_blob(settings.azure_storage_container, blob_key, att["data"], content_type)
            except Exception as e:
                log.error(f"[VENDOR]   Failed to upload attachment {att['file_name']!r} for {vendor_code}: {e}")
                continue
            db.add(VendorMasterAttachment(
                vendor_code=vendor_code,
                blob_container=settings.azure_storage_container,
                blob_key=blob_key,
                file_name=att["file_name"],
                content_type=content_type,
                size_bytes=att["size_bytes"],
                smartpal_uploaded_by=att.get("smartpal_uploaded_by"),
                smartpal_uploaded_at=att.get("smartpal_uploaded_at"),
                raw_json={"raw_cells": att.get("raw_cells")},
            ))

        db.commit()
        log.info(f"[VENDOR]   Detail scrape complete for {vendor_code}: {len(bank_rows)} bank row(s), {len(new_attachments)} new attachment(s).")
    except Exception as e:
        db.rollback()
        log.error(f"[VENDOR]   Detail scrape failed for {vendor_code}: {e}")
    finally:
        db.close()
