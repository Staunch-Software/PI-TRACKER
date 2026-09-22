"""Add pir_entries.resolved_at — tracks when a problematic invoice disappears from a fresh
SmartPAL scrape (meaning it was resolved/pushed to normal invoice processing), instead of
letting resolved rows sit in the table forever cluttering the "needs triage" view. See
PirEntry.resolved_at docstring.

Revision ID: 0018
Revises: 0014
Create Date: 2026-09-22

"""
from alembic import op

revision = "0018"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pir_entries ADD COLUMN resolved_at TIMESTAMPTZ")
    op.execute("CREATE INDEX ix_pir_entries_resolved_at ON pir_entries (resolved_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_pir_entries_resolved_at")
    op.execute("ALTER TABLE pir_entries DROP COLUMN IF EXISTS resolved_at")
