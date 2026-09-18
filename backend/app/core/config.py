from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    port: int = 8000
    environment: str = "development"
    database_url: str
    session_secret: str
    cors_allowed_origin: str = "http://localhost:5183"
    azure_storage_connection_string: str = ""
    azure_storage_container: str = "invoice-attachments"

    # ── SmartPAL / MariApps (shared by both scrapers below) ────────────────────
    # Microsoft SSO login for the automated SmartPAL login. The account must have MFA disabled
    # so generate_auth can complete headless. NEVER hardcode these — set them in .env. Mirrors
    # the convention in Vessel_Performance's backend/config.py (MARIAPPS_USERNAME/PASSWORD).
    mariapps_username: str = ""
    mariapps_password: str = ""
    # Login entry points — the SSO "SIGN IN" gate is domain-wide, so logging in via either page
    # mints a session cookie valid for the whole SmartPAL suite.
    approved_invoice_list_url: str = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/InvoiceList"
    pir_url: str = "https://smartpal.ozellar.com/AccountsPALApp/Accounts/ProblematicInvoiceOverview"
    mariapps_headless: bool = True


settings = Settings()

# Where each scraper's Playwright storage_state (session cookie) from generate_auth is saved —
# each has its own auth.json/generate_auth.py rather than sharing one, since PIR was built and
# then paused before the approved-invoice scraper existed; see each module's own docstring.
APPROVED_INVOICE_AUTH_JSON = BACKEND_ROOT / "app" / "services" / "approved_invoice_scraper" / "auth.json"
MARIAPPS_AUTH_JSON = BACKEND_ROOT / "app" / "services" / "pir_scraper" / "auth.json"
