"""Add users.can_access_vendor — per-user module access flag for the new Vendor Management
module, same convention as can_access_dd (0033_user_dd_access).

Revision ID: 0042
Revises: 0041
Create Date: 2026-10-30

"""
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_vendor BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_vendor")
