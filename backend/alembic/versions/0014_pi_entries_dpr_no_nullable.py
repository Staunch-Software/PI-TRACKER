"""Allow pi_entries.dpr_no to be NULL — a PI can be created via "Add New PI" before its DPR No.
is known/assigned. The existing UNIQUE constraint is left as-is: Postgres already permits
multiple NULL values under a UNIQUE constraint, so no constraint change is needed there, only
dropping NOT NULL.

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-22

"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pi_entries ALTER COLUMN dpr_no DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE pi_entries ALTER COLUMN dpr_no SET NOT NULL")
