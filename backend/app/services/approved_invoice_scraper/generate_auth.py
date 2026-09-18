# ===========================================================================
# backend/app/services/approved_invoice_scraper/generate_auth.py
#
# Automated Microsoft SSO login against SmartPAL — same flow as
# app/services/pir_scraper/generate_auth.py (confirmed live 2026-09-09: this
# scraper's InvoiceList page and PIR's ProblematicInvoiceOverview page share
# the same SSO gate and session, both under smartpal.ozellar.com), kept as
# its own copy rather than importing the (currently stashed/paused)
# pir_scraper module, so this scraper has no dependency on that paused work.
# The account must have MFA disabled for this to complete headless. Saves a
# Playwright storage_state to APPROVED_INVOICE_AUTH_JSON — every scrape run
# reuses that session instead of logging in again. Note (confirmed live):
# SmartPAL sessions here are short-lived (well under an hour), so a scrape
# run should regenerate auth first rather than assume a saved session is
# still good — see scraper.py's run().
# ===========================================================================
import logging
import time

from playwright.sync_api import sync_playwright

from app.core.config import APPROVED_INVOICE_AUTH_JSON, settings

log = logging.getLogger(__name__)


def run_automated_login() -> None:
    log.info("[AUTH]     Starting automated SmartPAL SSO login...")

    username = settings.mariapps_username
    password = settings.mariapps_password
    if not username or not password:
        raise RuntimeError(
            "MARIAPPS_USERNAME / MARIAPPS_PASSWORD are not set in .env — cannot run automated SmartPAL login."
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=settings.mariapps_headless)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        )
        page = context.new_page()
        context.add_init_script(
            "Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });"
        )

        log.info(f"[NAV]      Navigating to: {settings.approved_invoice_list_url}")
        page.goto(settings.approved_invoice_list_url, wait_until="load", timeout=60000)

        try:
            signin_btn = page.locator("text='SIGN IN'").first
            signin_btn.wait_for(state="visible", timeout=10000)
            signin_btn.click(force=True)
            log.info("[AUTH]     Clicked gate SIGN IN.")
        except Exception as e:
            log.warning(f"[AUTH]     Could not find/click sign-in gate: {e}")

        log.info("[AUTH]     Waiting for Microsoft email input...")
        try:
            page.wait_for_selector("input[name='loginfmt'], #i0116", timeout=20000)
            page.locator("input[name='loginfmt'], #i0116").fill(username)
            page.locator("#idSIButton9").click()
            time.sleep(2)
        except Exception as e:
            log.error(f"[AUTH]     Failed to enter email: {e}")
            browser.close()
            raise

        try:
            use_password = page.locator("text='Use my password'").first
            use_password.wait_for(state="visible", timeout=5000)
            use_password.click()
            log.info("[AUTH]     'Choose a way to sign in' screen shown — clicked 'Use my password'.")
            time.sleep(1)
        except Exception:
            pass

        log.info("[AUTH]     Entering password...")
        try:
            page.wait_for_selector("input[name='passwd'], #i0118", timeout=10000)
            page.locator("input[name='passwd'], #i0118").fill(password)
            page.locator("#idSIButton9").click()
            time.sleep(2)
        except Exception as e:
            log.error(f"[AUTH]     Failed to enter password: {e}")
            browser.close()
            raise

        log.info("[AUTH]     Handling 'Stay signed in'...")
        try:
            page.wait_for_selector("#idSIButton9", timeout=5000)
            page.locator("#idSIButton9").click()
        except Exception:
            pass

        log.info("[AUTH]     Waiting for redirect to land...")
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
            APPROVED_INVOICE_AUTH_JSON.parent.mkdir(parents=True, exist_ok=True)
            context.storage_state(path=str(APPROVED_INVOICE_AUTH_JSON))
            log.info(f"[AUTH]     SSO session saved to {APPROVED_INVOICE_AUTH_JSON}")
        except Exception as e:
            log.error(f"[AUTH]     Redirect/save failed: {e}")
            raise

        browser.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run_automated_login()
