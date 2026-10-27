"""Add users.can_access_dd — per-user module access flag for the new DD Tracker module, same
convention as can_access_landing (0028_user_landing_access).

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-27

"""
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_dd BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_dd")
