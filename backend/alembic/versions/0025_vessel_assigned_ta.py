"""vessel assigned_ta_id

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-23
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE vessels ADD COLUMN assigned_ta_id UUID REFERENCES users(id)")


def downgrade() -> None:
    op.execute("ALTER TABLE vessels DROP COLUMN IF EXISTS assigned_ta_id")
