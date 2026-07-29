"""Add IMO number to vessels.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-29

"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE vessels ADD COLUMN imo_number TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE vessels DROP COLUMN IF EXISTS imo_number")
