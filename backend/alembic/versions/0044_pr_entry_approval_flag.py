"""Add pr_entries.approval_flag — SmartPAL's own "approvalflag" field (Approved / Finally
Approved / Pending / Rejected / Cancelled), which is the field that actually reflects a
requisition being rejected or cancelled after the fact. pr_entries.status does NOT get reset in
that case — confirmed live 2026-11-03 via a requisition cancelled after approval, whose status
stayed "Requisition Approved" while approvalflag correctly read "Cancelled". See
api/routes/dd_tracker.py's _effective_pr_status for how DD Tracker combines the two.

Revision ID: 0044
Revises: 0043
Create Date: 2026-11-03

"""
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE pr_entries ADD COLUMN approval_flag TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE pr_entries DROP COLUMN IF EXISTS approval_flag")
