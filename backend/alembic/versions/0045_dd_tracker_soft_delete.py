"""Add dd_tracker_entries.deleted_at for soft delete — the team wants to bulk-select and
delete rows from the DD Tracker UI, but a row must never actually disappear from the table
(and must never be re-created by the scraper's own dedup check in
_sync_dd_tracker_entries, which still sees this row and leaves it alone) once deleted. See
api/routes/dd_tracker.py.

Revision ID: 0045
Revises: 0044
Create Date: 2026-11-04

"""
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN deleted_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN IF EXISTS deleted_at")
