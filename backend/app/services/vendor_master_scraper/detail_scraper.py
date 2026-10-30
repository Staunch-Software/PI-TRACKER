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


def _scrape_contacts(page) -> dict:
    try:
        page.locator("text=Vendor Contacts").first.click(timeout=5000)
        page.wait_for_timeout(1500)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open Vendor Contacts tab: {e}")
        return {}

    def _field(label: str) -> str | None:
        try:
            value = page.get_by_label(label).input_value(timeout=2000)
            return value.strip() or None
        except Exception:
            return None

    contacts: list[dict] = []
    try:
        rows = page.locator("table tbody tr").all()
        for row in rows:
            cells = [c.strip() for c in row.locator("td").all_inner_texts()]
            if cells:
                contacts.append({"raw_cells": cells})
    except Exception:
        pass

    return {
        "address": _field("Address"),
        "phone_1": _field("Phone 1"),
        "phone_2": _field("Phone 2"),
        "fax_1": _field("Fax"),
        "fax_2": _field("Fax 2"),
        "telex": _field("Telex"),
        "website": _field("Website"),
        "zip_code": _field("Zip Code"),
        "email": _field("Email"),
        "city": _field("City"),
        "country": _field("Country"),
        "state": _field("State"),
        "contacts": contacts,
    }


def _scrape_bank_details(page) -> list[dict]:
    try:
        page.locator("text=Bank Details").first.click(timeout=5000)
        page.wait_for_timeout(1500)
    except Exception as e:
        log.warning(f"[VENDOR]   Could not open Bank Details tab: {e}")
        return []

    rows: list[dict] = []
    try:
        for row in page.locator("table tbody tr").all():
            cells = [c.strip() for c in row.locator("td").all_inner_texts()]
            if not cells or not any(cells):
                continue
            # Column order per the real Bank Details tab (confirmed via screenshot 2026-10-30):
            # Beneficiary Name, Branch Name, Bank Name, Country, Bank Code, Currency,
            # Account Number, Default, Active, IBAN, Swift Code, ABA No.
            padded = cells + [None] * (12 - len(cells))
            rows.append({
                "beneficiary_name": padded[0] or None,
                "branch_name": padded[1] or None,
                "bank_name": padded[2] or None,
                "country": padded[3] or None,
                "bank_code": padded[4] or None,
                "currency": padded[5] or None,
                "account_number": padded[6] or None,
                "is_default": bool(padded[7]),
                "is_active": bool(padded[8]),
                "iban": padded[9] or None,
                "swift_code": padded[10] or None,
                "aba_no": padded[11] or None,
                "raw_cells": cells,
            })
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
