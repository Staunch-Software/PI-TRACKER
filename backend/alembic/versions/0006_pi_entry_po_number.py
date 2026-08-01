"""Add po_number (Purchase Order number) free-text column to pi_entries.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-01

"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pi_entries ADD COLUMN po_number TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE pi_entries DROP COLUMN po_number")
