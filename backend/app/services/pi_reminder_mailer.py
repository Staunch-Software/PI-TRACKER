# ===========================================================================
# backend/app/services/pi_reminder_mailer.py
#
# Sends the PI Tracker's two automated reminder emails via Microsoft Graph API
# (users/{mailbox}/sendMail), using the SAME Azure AD app registration as the SOA module's
# mailbox polling — just a different permission (Mail.Send, application, admin-consented)
# and a different mailbox (purchase@ozellar.com, not a polled SOA mailbox).
#
# Deliberately its own small module with its own token acquisition (~15 lines, duplicated from
# soa_scraper/ms_graph_client.py) rather than importing that module — same "module independence
# over cross-imports between unrelated features" convention already established for the
# scrapers (see config.py's comment on why pir_scraper/approved_invoice_scraper each have their
# own auth.json rather than sharing one).
#
# truststore.inject_into_ssl() is required on this network — see ms_graph_client.py's docstring
# for why (an Acronis DeviceLock DLP root CA that Windows trusts but Python's certifi bundle
# doesn't; harmless no-op on a network without that TLS-inspecting proxy).
# ===========================================================================
import logging

import truststore

truststore.inject_into_ssl()

import requests  # noqa: E402

from app.core.config import settings  # noqa: E402

log = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# Fallback mailbox used when a PI's vessel has no assigned TA — purchase@ozellar.com is a
# distribution list, not a real mailbox, so Graph's sendMail would 404 on it the same way SOA
# polling's /messages read would (a DL has no mailbox to send "as"). Using a real,
# Graph-API-enabled mailbox instead. The normal path sends "as" the vessel's assigned TA (see
# pi_entries.py's send-vendor-notice/send-owner-reminder), since Mail.Send is an application
# permission that lets this app send as any real mailbox in the tenant.
DEFAULT_FROM_MAILBOX = "sunilkumar.s@ozellar.com"

# TEMPORARY: while verifying the send pipeline end-to-end, redirect every send to a test inbox
# instead of the real vendor/owner recipients, per the user's explicit test instructions. Flip
# this to False once Graph permissions + real recipients are confirmed working.
TEST_MODE = True
TEST_MODE_TO = ["techdevops@ozellar.com"]
TEST_MODE_CC = ["Karunya.pius@ozellar.com"]


def _get_token() -> str:
    resp = requests.post(
        f"https://login.microsoftonline.com/{settings.ms_graph_tenant_id}/oauth2/v2.0/token",
        data={
            "client_id": settings.ms_graph_client_id,
            "client_secret": settings.ms_graph_client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def send_mail(to_emails: list[str], subject: str, html_body: str, from_mailbox: str | None = None) -> None:
    """Raises requests.HTTPError on failure — callers surface this as a 502 to the frontend
    rather than silently swallowing a failed send (the user needs to know the email did NOT go
    out, since this isn't retried automatically).

    from_mailbox: the vessel's assigned TA's email, or DEFAULT_FROM_MAILBOX when the vessel has
    no TA assigned yet."""
    if not to_emails:
        raise ValueError("send_mail called with no recipients")

    send_from = from_mailbox or DEFAULT_FROM_MAILBOX

    cc_emails: list[str] = []
    if TEST_MODE:
        log.info("pi_reminder_mailer TEST_MODE active — redirecting send from %s to %s", to_emails, TEST_MODE_TO)
        to_emails = TEST_MODE_TO
        cc_emails = TEST_MODE_CC

    message: dict = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": html_body},
        "toRecipients": [{"emailAddress": {"address": e}} for e in to_emails],
    }
    if cc_emails:
        message["ccRecipients"] = [{"emailAddress": {"address": e}} for e in cc_emails]

    token = _get_token()
    resp = requests.post(
        f"{GRAPH_BASE}/users/{send_from}/sendMail",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"message": message, "saveToSentItems": True},
        timeout=30,
    )
    resp.raise_for_status()
