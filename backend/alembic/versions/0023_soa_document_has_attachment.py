"""Add soa_documents.has_attachment — Graph's own hasAttachments flag on the source email,
surfaced in the vendor-grouped SOA UI so a user can see which vendors' SOAs came with a real
attachment behind the extracted data. See SoaDocument docstring.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-22

"""
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE soa_documents ADD COLUMN has_attachment BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE soa_documents DROP COLUMN IF EXISTS has_attachment")
