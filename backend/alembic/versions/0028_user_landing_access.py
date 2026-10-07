"""Add users.can_access_landing — per-user module access flag for the Landing Reports module,
same convention as can_access_soa (0020_user_soa_access).

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-07

"""
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_landing BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_landing")
