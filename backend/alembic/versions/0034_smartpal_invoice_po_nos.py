"""Add smartpal_invoice_entries.po_nos — confirmed live 2026-10-28 that SmartPAL's own invoice
row already carries this field ("poNos" in raw_json, e.g. "GCNA/O-0324/PO26") even though it was
never surfaced as its own column; backfilled from the raw_json already captured by every row
scraped so far. Feeds the DD Tracker module's live invoice join (see dd_tracker.py routes).

Revision ID: 0034
Revises: 0033
Create Date: 2026-10-28

"""
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE smartpal_invoice_entries ADD COLUMN po_nos TEXT")
    op.execute("UPDATE smartpal_invoice_entries SET po_nos = raw_json->>'poNos' WHERE raw_json->>'poNos' IS NOT NULL")
    op.execute("CREATE INDEX ix_smartpal_invoice_entries_po_nos ON smartpal_invoice_entries (po_nos)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_smartpal_invoice_entries_po_nos")
    op.execute("ALTER TABLE smartpal_invoice_entries DROP COLUMN IF EXISTS po_nos")
