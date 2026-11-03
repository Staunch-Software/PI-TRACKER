"""Add dd_tracker_entries.supply_port — a manual override for the live
po_entries.schd_del_port value, letting the team correct/fill in a Supply Port the
PO scrape got wrong or never had, without losing the live join (see
dd_tracker_entry.py docstring and api/routes/dd_tracker.py's _to_out).

Revision ID: 0043
Revises: 0042
Create Date: 2026-11-03

"""
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN supply_port TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN IF EXISTS supply_port")
