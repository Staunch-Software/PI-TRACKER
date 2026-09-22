"""Add users.can_access_soa — per-user module access flag for the new SOA reconciliation module,
same convention as can_access_pi/can_access_pir (0009_user_module_access).

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-22

"""
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_soa BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_soa")
