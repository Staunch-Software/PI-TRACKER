"""Add users.can_access_pending_items — per-user module access flag for the TSI/TA Pending
Items report, same convention as can_access_pd (0050_user_pd_access). Previously gated on the
can_access_dd flag as a shortcut (no migration needed); split into its own flag per direct user
request so it shows as its own toggle in the admin Module Access panel.

Revision ID: 0051
Revises: 0050
Create Date: 2026-11-15

"""
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_pending_items BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS can_access_pending_items")
