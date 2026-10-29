"""DD Tracker: drop the manual lead_days column — it's now computed live as
(readiness_date - po_entries.confirmed_date), the vendor's actual lead time, instead of a
number the team typed in by hand. See api/routes/dd_tracker.py.

Revision ID: 0036
Revises: 0035
Create Date: 2026-10-29

"""
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN lead_days")


def downgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN lead_days INTEGER")
