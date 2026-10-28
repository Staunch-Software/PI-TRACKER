"""DD Tracker: merge remarks_1/remarks_2 into one remarks column, and drop the manual
invoice_number/invoice_amount/invoice_currency columns now that the module joins them live from
smartpal_invoice_entries (matched by po_nos) — see app/models/dd_tracker_entry.py docstring.

Revision ID: 0035
Revises: 0034
Create Date: 2026-10-28

"""
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN remarks TEXT")
    op.execute(
        """
        UPDATE dd_tracker_entries
        SET remarks = NULLIF(
            TRIM(BOTH ' | ' FROM COALESCE(remarks_1, '') || CASE WHEN remarks_2 IS NOT NULL THEN ' | ' || remarks_2 ELSE '' END),
            ''
        )
        WHERE remarks_1 IS NOT NULL OR remarks_2 IS NOT NULL
        """
    )
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN remarks_1")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN remarks_2")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN invoice_number")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN invoice_amount")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN invoice_currency")


def downgrade() -> None:
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN remarks_1 TEXT")
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN remarks_2 TEXT")
    op.execute("UPDATE dd_tracker_entries SET remarks_1 = remarks")
    op.execute("ALTER TABLE dd_tracker_entries DROP COLUMN remarks")
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN invoice_number TEXT")
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN invoice_amount NUMERIC")
    op.execute("ALTER TABLE dd_tracker_entries ADD COLUMN invoice_currency TEXT")
