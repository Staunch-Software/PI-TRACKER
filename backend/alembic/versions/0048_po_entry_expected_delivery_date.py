"""Add po_entries.expected_delivery_date — SmartPAL's "Scheduled Delivery Date" (raw field
schd_Del_Date), confirmed live against a real PO. DD Tracker's Readiness Date now defaults to
this when not manually overridden — see api/routes/dd_tracker.py.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-04

"""
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE po_entries ADD COLUMN expected_delivery_date DATE")


def downgrade() -> None:
    op.execute("ALTER TABLE po_entries DROP COLUMN IF EXISTS expected_delivery_date")
