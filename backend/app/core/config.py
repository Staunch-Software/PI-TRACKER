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

    # ── SmartPAL / MariApps (approved-invoice scraper) ─────────────────────────
    # Microsoft SSO login for the automated SmartPAL login. The account must have MFA disabled
    # so generate_auth can complete headless. NEVER hardcode these — set them in .env.
    mariapps_username: str = ""
    mariapps_password: str = ""
    # Login entry point — SmartPAL's SSO "SIGN IN" gate is domain-wide, so logging in via this
    # page mints a session cookie valid for the whole SmartPAL suite.
    approved_invoice_list_url: str = "https://smartpal.ozellar.com/PurchasePALApp/Purchase/InvoiceList"
    mariapps_headless: bool = True


settings = Settings()

# Where the Playwright storage_state (session cookie) from generate_auth is saved.
APPROVED_INVOICE_AUTH_JSON = BACKEND_ROOT / "app" / "services" / "approved_invoice_scraper" / "auth.json"
