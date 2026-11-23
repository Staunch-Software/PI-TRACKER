"""Add category_name to smartpal_invoice_entries — SmartPAL's own invoice-level category
(e.g. "OPEX - CREW EXPENSES"), was already present in raw_json but never its own column.

Revision ID: 0056
Revises: 0055
Create Date: 2026-11-23
"""
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE smartpal_invoice_entries ADD COLUMN IF NOT EXISTS category_name TEXT;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE smartpal_invoice_entries DROP COLUMN IF EXISTS category_name")
