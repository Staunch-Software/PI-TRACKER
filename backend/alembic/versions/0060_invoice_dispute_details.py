"""Add disputed_by/disputed_at/disputed_remarks to smartpal_invoice_entries — who disputed a
Disputed invoice, when, and the remark, scraped from the per-invoice Pending List popup (not
present in the main Invoice List grid data at all).

Revision ID: 0060
Revises: 0059
Create Date: 2026-11-26
"""
from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE smartpal_invoice_entries ADD COLUMN IF NOT EXISTS disputed_by TEXT;
        ALTER TABLE smartpal_invoice_entries ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMP;
        ALTER TABLE smartpal_invoice_entries ADD COLUMN IF NOT EXISTS disputed_remarks TEXT;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE smartpal_invoice_entries DROP COLUMN IF EXISTS disputed_by;
        ALTER TABLE smartpal_invoice_entries DROP COLUMN IF EXISTS disputed_at;
        ALTER TABLE smartpal_invoice_entries DROP COLUMN IF EXISTS disputed_remarks;
        """
    )
