"""Add smartpal_invoice_entries.paid_status (SmartPAL's own "paidStatus" field, already present
in raw_json but never its own column — confirmed live 2026-10-30 it's real: 'PAID' on ~33% of
scraped rows, null otherwise, no other values seen), and drop DD Tracker's manual payment_status
column now that the module joins it live from this field instead (same "join live, don't
duplicate" stance as invoice_number/invoice_amount/invoice_currency/invoice_status — see
app/models/dd_tracker_entry.py and app/api/routes/dd_tracker.py).

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-30

"""
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE smartpal_invoice_entries ADD COLUMN paid_status TEXT")
    op.execute("UPDATE smartpal_invoice_entries SET paid_status = raw_json->>'paidStatus'")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN payment_status")


def downgrade() -> None:
    op.execute("ALTER TABLE smartpal_invoice_entries DROP COLUMN paid_status")
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN payment_status TEXT")
