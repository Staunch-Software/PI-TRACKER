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

    # ── Microsoft Graph API (SOA reconciliation module) ─────────────────────────
    # App-only (client-credentials) auth against an Azure AD app registration with Mail.Read
    # application permission, tenant-admin-consented — NOT a signed-in user, so it can read any
    # mailbox in the tenant by address, same unattended-service-account role as the SmartPAL
    # SSO account above. NEVER hardcode these — set them in .env.
    ms_graph_tenant_id: str = ""
    ms_graph_client_id: str = ""
    ms_graph_client_secret: str = ""

    # purchase@ozellar.com is a distribution list, not a real mailbox — Graph's
    # /users/{mailbox}/messages 404s on it (ErrorInvalidUser). Its recipients overlap with the
    # 4 mailboxes below (confirmed live: purchase@ is CC'd alongside these on real SOA threads),
    # so it's deliberately excluded rather than polled.
    soa_mailboxes: list[str] = [
        "soa@ozellar.com",
        "sunilkumar.s@ozellar.com",
        "Karunya.pius@ozellar.com",
        "viswanathan.n@ozellar.com",
    ]
    invoice_mailbox: str = "invoice@ozellar.com"

    # Our own company's domain(s) — when a polled SOA mailbox's immediate sender is one of these,
    # they're an internal Accounts/Purchase staff member forwarding/replying on an existing
    # vendor thread, NOT the vendor themselves (confirmed live: hemavathy.v@ozellar.com replying
    # on a Navarino thread got mis-attributed as its own bogus vendor before this existed). See
    # soa_scraper/document_text.py extract_original_external_sender.
    internal_email_domains: set[str] = {"ozellar.com"}

    # ── Ollama (local LLM extraction — see soa_extraction/) ─────────────────────
    # Self-hosted, not the Anthropic API — SOA/invoice content never leaves the network. Model
    # chosen for the dev PoC (CPU-only laptop, no dedicated GPU); swap for a larger model once
    # this runs on real infrastructure.
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"


settings = Settings()

# Where each scraper's Playwright storage_state (session cookie) from generate_auth is saved —
# each has its own auth.json/generate_auth.py rather than sharing one, since PIR was built and
# then paused before the approved-invoice scraper existed; see each module's own docstring.
APPROVED_INVOICE_AUTH_JSON = BACKEND_ROOT / "app" / "services" / "approved_invoice_scraper" / "auth.json"
MARIAPPS_AUTH_JSON = BACKEND_ROOT / "app" / "services" / "pir_scraper" / "auth.json"
