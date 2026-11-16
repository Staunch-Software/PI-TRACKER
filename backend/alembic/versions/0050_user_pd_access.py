"""Add users.can_access_pd — per-user module access flag for the new PD Tracker module, same
convention as can_access_dd (0033_user_dd_access) / can_access_vendor (0042_user_vendor_access).

Revision ID: 0050
Revises: 0049
Create Date: 2026-11-12

"""
from alembic import op

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_pd BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_pd")
