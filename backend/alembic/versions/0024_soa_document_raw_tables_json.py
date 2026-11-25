"""Add soa_documents.raw_tables_json — the deterministically-extracted table structure (rows +
context text, see table_extraction.Table) exactly as parsed from the email body/attachments,
stored regardless of whether a recognizable line-item header was found. Lets a failed/incomplete
parse be reprocessed later (improved keyword lists, bug fixes) without re-polling Microsoft Graph,
and lets a human see the actual raw content behind an "UNPARSED-..." placeholder line item
instead of just its label. See SoaDocument docstring.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-25

"""
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE soa_documents ADD COLUMN raw_tables_json JSONB NOT NULL DEFAULT '[]'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE soa_documents DROP COLUMN IF EXISTS raw_tables_json")
