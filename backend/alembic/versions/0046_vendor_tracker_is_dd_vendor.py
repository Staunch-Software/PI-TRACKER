"""Add vendor_tracker_entries.is_dd_vendor — classification flag splitting the Vendor
Management UI into "All Vendors" / "DD Vendors" tabs over the SAME underlying rows (confirmed
with the user 2026-11-04: not two datasets, one boolean). Existing rows (all created via the
current "+ Add DD Vendor" flow) are backfilled to true so today's DD Vendors list is unchanged
after this migration.

Revision ID: 0046
Revises: 0045
Create Date: 2026-11-04

"""
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE vendor_tracker_entries ADD COLUMN is_dd_vendor BOOLEAN NOT NULL DEFAULT false")
    op.execute("UPDATE vendor_tracker_entries SET is_dd_vendor = true")


def downgrade() -> None:
    op.execute("ALTER TABLE vendor_tracker_entries DROP COLUMN IF EXISTS is_dd_vendor")
