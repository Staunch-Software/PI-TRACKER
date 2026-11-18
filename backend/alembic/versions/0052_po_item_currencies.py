"""Add po_item_entries.po_currency and vessel_currency, backfilling from po_entries and smartpal_invoice_entries.

Revision ID: 0052
Revises: 0051
Create Date: 2026-11-18
"""
from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE po_item_entries ADD COLUMN IF NOT EXISTS po_currency TEXT")
    op.execute("ALTER TABLE po_item_entries ADD COLUMN IF NOT EXISTS vessel_currency TEXT")

    # 1. Backfill vessel_currency from po_entries.base_currency
    op.execute(
        """
        UPDATE po_item_entries pie
        SET vessel_currency = pe.base_currency
        FROM po_entries pe
        WHERE pie.po_no = pe.po_no AND pe.base_currency IS NOT NULL;
        """
    )
    op.execute(
        """
        UPDATE po_item_entries
        SET vessel_currency = CASE WHEN vessel_name ILIKE '%AMNS%' THEN 'INR' ELSE 'USD' END
        WHERE vessel_currency IS NULL;
        """
    )

    # 2. Backfill po_currency from smartpal_invoice_entries.currency_code
    op.execute(
        """
        UPDATE po_item_entries pie
        SET po_currency = sie.currency_code
        FROM smartpal_invoice_entries sie
        WHERE pie.po_no = sie.po_nos AND sie.currency_code IS NOT NULL;
        """
    )

    # 3. Fallback po_currency to vessel_currency where still null
    op.execute(
        """
        UPDATE po_item_entries
        SET po_currency = vessel_currency
        WHERE po_currency IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE po_item_entries DROP COLUMN IF EXISTS po_currency")
    op.execute("ALTER TABLE po_item_entries DROP COLUMN IF EXISTS vessel_currency")
