# ===========================================================================
# backend/app/services/soa_scraper/ms_graph_client.py
#
# Microsoft Graph API client for the SOA reconciliation module, using app-only
# (client-credentials) auth: the Azure AD app registration has Mail.Read APPLICATION
# permission (tenant-admin-consented), so it can read any mailbox by address without a
# per-user sign-in — unattended, same service-account role as MARIAPPS_USERNAME/PASSWORD.
#
# truststore.inject_into_ssl() is required on this network: confirmed live that requests/
# certifi's bundled CA list rejects the TLS chain here with "self signed certificate in
# certificate chain" — caused by an Acronis DeviceLock DLP root CA installed in Windows'
# trusted store (endpoint TLS-inspection software), which Windows trusts but certifi doesn't.
# truststore makes Python's ssl module use the OS trust store instead, which already trusts it.
# ===========================================================================
import base64
import logging
from dataclasses import dataclass, field
from typing import Any

import truststore

truststore.inject_into_ssl()

import requests  # noqa: E402

from app.core.config import settings  # noqa: E402

log = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


@dataclass
class GraphMessage:
    id: str
    # Graph's `internetMessageId` (the RFC 5322 Message-ID header) is the SAME across every
    # recipient's mailbox-scoped copy of one physical email — unlike `id`, which Graph mints
    # per-mailbox. Used to dedupe a CC'd SOA email across the 4 polled SOA mailboxes so it's
    # only extracted once, not once per mailbox it landed in (see ingest.py).
    internet_message_id: str
    subject: str
    received_at: str
    sender_email: str
    sender_name: str | None
    has_attachments: bool
    body_html: str
    attachments: list[dict[str, Any]] = field(default_factory=list)


class MsGraphClient:
    def __init__(self) -> None:
        if not (settings.ms_graph_tenant_id and settings.ms_graph_client_id and settings.ms_graph_client_secret):
            raise RuntimeError(
                "MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET are not set in .env — "
                "cannot authenticate against Microsoft Graph."
            )
        self._token: str | None = None

    def _get_token(self) -> str:
        if self._token:
            return self._token
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
        self._token = resp.json()["access_token"]
        return self._token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._get_token()}"}

    def list_recent_messages(self, mailbox: str, top: int = 25) -> list[dict[str, Any]]:
        """Newest-first, most recent `top` messages — the ingestion loop dedupes against
        graph_message_id already in soa_documents/invoice_mail_entries, so re-polling is safe."""
        resp = requests.get(
            f"{GRAPH_BASE}/users/{mailbox}/messages",
            headers=self._headers(),
            params={
                "$top": top,
                "$orderby": "receivedDateTime desc",
                "$select": "id,internetMessageId,subject,from,receivedDateTime,hasAttachments,body",
            },
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("value", [])

    def list_attachments(self, mailbox: str, message_id: str) -> list[dict[str, Any]]:
        resp = requests.get(
            f"{GRAPH_BASE}/users/{mailbox}/messages/{message_id}/attachments",
            headers=self._headers(),
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("value", [])

    def get_message(self, mailbox: str, raw: dict[str, Any], with_attachments: bool = True) -> GraphMessage:
        frm = (raw.get("from") or {}).get("emailAddress") or {}
        attachments = []
        if with_attachments and raw.get("hasAttachments"):
            for att in self.list_attachments(mailbox, raw["id"]):
                if "contentBytes" not in att:
                    continue  # skip inline/referenced attachments we can't fetch bytes for here
                attachments.append(
                    {
                        "name": att.get("name", "attachment"),
                        "content_type": att.get("contentType", ""),
                        "bytes": base64.b64decode(att["contentBytes"]),
                    }
                )
        return GraphMessage(
            id=raw["id"],
            internet_message_id=raw.get("internetMessageId") or raw["id"],
            subject=raw.get("subject") or "",
            received_at=raw["receivedDateTime"],
            sender_email=(frm.get("address") or "").lower(),
            sender_name=frm.get("name"),
            has_attachments=bool(raw.get("hasAttachments")),
            body_html=(raw.get("body") or {}).get("content") or "",
            attachments=attachments,
        )
