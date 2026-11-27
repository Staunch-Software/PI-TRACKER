"""Add is_open_po to po_entries — flags a PO as currently on SmartPAL's own "Open POs" tab
(Purchase/POOverview, approvalFlag=50/chatStatus=ALL/isDateFilter=N — confirmed live 2026-11-27),
independent of approved_status/TSI-TA approval workflow. Refreshed wholesale on every scrape run
(see po_scraper._run_open_po): every po_no in the fresh Open POs fetch is set True, everything
previously True but no longer returned is reset to False.

Revision ID: 0061
Revises: 0060
Create Date: 2026-11-27
"""
from alembic import op

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE po_entries ADD COLUMN IF NOT EXISTS is_open_po BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS ix_po_entries_is_open_po ON po_entries (is_open_po);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS ix_po_entries_is_open_po;
        ALTER TABLE po_entries DROP COLUMN IF EXISTS is_open_po;
        """
    )
