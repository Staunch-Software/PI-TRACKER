# ===========================================================================
# backend/app/services/pir_scraper/generate_auth.py
#
# Automated Microsoft SSO login against SmartPAL, adapted from
# Vessel_Performance's Data_ingestion_pipeline/backend/mariapps_pipeline/
# generate_auth.py (same account/login flow — SmartPAL's SSO gate is shared
# across its PerformancePALApp and AccountsPALApp modules, so logging in via
# the PIR page mints a session cookie valid for the whole suite). The account
# must have MFA disabled for this to complete without human interaction.
# Saves a Playwright storage_state to MARIAPPS_AUTH_JSON — every scrape run
# reuses that session instead of logging in again.
# ===========================================================================
import logging
import time

from playwright.sync_api import sync_playwright

from app.core.config import MARIAPPS_AUTH_JSON, settings

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

        log.info(f"[NAV]      Navigating to: {settings.pir_url}")
        page.goto(settings.pir_url, wait_until="domcontentloaded")

        # --- STEP 1: "SIGN IN" gate ---
        log.info("[AUTH]     Looking for 'SIGN IN' gate button...")
        try:
            signin_btn = page.locator("text='SIGN IN'").first
            signin_btn.wait_for(state="visible", timeout=10000)
            signin_btn.click(force=True)
            log.info("[AUTH]     Clicked gate SIGN IN.")
        except Exception as e:
            log.warning(f"[AUTH]     Could not find/click sign-in gate: {e}")

        # --- STEP 2: Email ---
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

        # --- STEP 2b: "Choose a way to sign in" (MFA-method picker) — click "Use my
        # password" if it shows up; skip silently otherwise (older/direct flow). ---
        try:
            use_password = page.locator("text='Use my password'").first
            use_password.wait_for(state="visible", timeout=5000)
            use_password.click()
            log.info("[AUTH]     'Choose a way to sign in' screen shown — clicked 'Use my password'.")
            time.sleep(1)
        except Exception:
            pass

        # --- STEP 3: Password ---
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

        # --- STEP 4: "Stay signed in" ---
        log.info("[AUTH]     Handling 'Stay signed in'...")
        try:
            page.wait_for_selector("#idSIButton9", timeout=5000)
            page.locator("#idSIButton9").click()
        except Exception:
            pass

        # --- STEP 5: Save session ---
        log.info("[AUTH]     Waiting for redirect to land...")
        try:
            page.wait_for_load_state("networkidle", timeout=30000)
            MARIAPPS_AUTH_JSON.parent.mkdir(parents=True, exist_ok=True)
            context.storage_state(path=str(MARIAPPS_AUTH_JSON))
            log.info(f"[AUTH]     SSO session saved to {MARIAPPS_AUTH_JSON}")
        except Exception as e:
            log.error(f"[AUTH]     Redirect/save failed: {e}")
            raise

        browser.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    run_automated_login()
