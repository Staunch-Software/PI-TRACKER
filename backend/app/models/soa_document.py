import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class SoaDocument(Base):
    """One row per ingested Statement of Account email (see soa_scraper/ingest.py), scraped from
    the 4 SOA mailboxes via Microsoft Graph API (app-only auth — see MS_GRAPH_* settings).

    Vendors send a new/updated SOA every few weeks with NO stable identifier linking it to the
    previous one — confirmed live against real ABS/Navarino mail: the same vendor re-sent an
    "updated SOA" 4 times over 2 months, each a standalone email. So versioning is done by
    canonical_domain (vendor identity), not a document reference: when a new SOA arrives for a
    vendor that already has a current one, the old row's is_current flips to False (soft-delete —
    see class docstring on SoaLineItem) rather than being deleted, and the new row becomes
    current. vendor_name_raw is the SENDER's identity (e.g. "Shell Marine Products Singapore",
    "Den-Jet Marine Pte Ltd"), not the customer named inside the SOA body/table — confirmed live
    that some vendor formats (Shell) roll everything up under "OZELLAR GLOBAL PTE. LTD." (us, the
    customer) with no vendor name in the table at all, so vendor identity MUST come from the
    email's From field / sender domain, never parsed out of the document content.
    """

    __tablename__ = "soa_documents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    # Graph API message id — mailbox-scoped, kept for reference (fetching this specific copy's
    # attachments back from Graph needs it) but NOT the ingestion dedupe key — see
    # internet_message_id below for why.
    graph_message_id: Mapped[str] = mapped_column(Text, unique=True, nullable=False, index=True)

    # The email's actual Message-ID (RFC 5322 header, Graph's `internetMessageId`) — identical
    # across every recipient's mailbox-scoped copy of one physical email. THIS is the real
    # ingestion dedupe key: confirmed live that a CC'd SOA email lands in multiple of the 4
    # polled SOA mailboxes with a DIFFERENT graph_message_id in each one, so deduping on that
    # alone let the same email get extracted (and billed in Ollama compute) once per mailbox it
    # happened to CC. Checked before running extraction at all, not just before insert.
    internet_message_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)

    mailbox: Mapped[str] = mapped_column(Text, nullable=False)
    sender_email: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    sender_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Normalized sender domain (lowercased, e.g. "shell.com") — the RAW identity as it arrived.
    sender_domain: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    # The vendor-identity key actually used for "find the previous current SOA for this vendor to
    # soft-delete" — sender_domain resolved through soa_vendor_domain_aliases, defaulting to
    # sender_domain itself when no alias exists. Confirmed live this distinction is load-bearing:
    # Navarino sends from both navarino.gr and navarino.com.cy for the same account (see
    # SoaVendorDomainAlias docstring) — without resolving to one canonical key, both compare as
    # different vendors and neither ever supersedes the other.
    canonical_domain: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    vendor_name_raw: Mapped[str | None] = mapped_column(Text, nullable=True)

    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Graph's own hasAttachments flag on the source email — surfaced in the vendor-grouped UI so
    # a user can see at a glance which vendors' SOAs came with a real document (PDF/Excel/etc.)
    # behind the extracted line items, vs. an inline-HTML-table-only email (Shell's format, e.g.).
    # We don't store/serve the attachment file itself (no blob storage wired up for this module
    # yet — unlike PI entries' invoice_attachments), just this indicator.
    has_attachment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Soft-delete/versioning flag — see class docstring. False means a newer SOA superseded it;
    # the row and its line items are kept for audit history, never hard-deleted.
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
