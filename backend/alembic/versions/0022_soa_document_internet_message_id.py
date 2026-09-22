"""Add soa_documents.internet_message_id — the email's actual Message-ID (identical across every
recipient's mailbox-scoped copy of one physical email), used as the real ingestion dedupe key
instead of the per-mailbox graph_message_id. Fixes redundant Ollama extraction of the same SOA
email when it's CC'd across multiple of the 4 polled SOA mailboxes. See SoaDocument docstring.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-22

"""
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Backfill existing rows with their own graph_message_id as a placeholder — there is no way
    # to retroactively recover the real internetMessageId for already-ingested documents without
    # re-fetching each one from Graph, and existing rows are already deduped by graph_message_id
    # (just not across mailboxes), so this is a safe, non-destructive default.
    op.execute("ALTER TABLE soa_documents ADD COLUMN internet_message_id TEXT")
    op.execute("UPDATE soa_documents SET internet_message_id = graph_message_id WHERE internet_message_id IS NULL")
    op.execute("ALTER TABLE soa_documents ALTER COLUMN internet_message_id SET NOT NULL")
    op.execute("CREATE INDEX ix_soa_documents_internet_message_id ON soa_documents (internet_message_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_soa_documents_internet_message_id")
    op.execute("ALTER TABLE soa_documents DROP COLUMN IF EXISTS internet_message_id")
