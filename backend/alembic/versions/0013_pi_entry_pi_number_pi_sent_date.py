"""Add pi_number (free-text) and pi_sent_date (date) columns to pi_entries, next to po_number.

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-18

"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pi_entries ADD COLUMN pi_number TEXT")
    op.execute("ALTER TABLE pi_entries ADD COLUMN pi_sent_date DATE")


def downgrade() -> None:
    op.execute("ALTER TABLE pi_entries DROP COLUMN pi_sent_date")
    op.execute("ALTER TABLE pi_entries DROP COLUMN pi_number")
