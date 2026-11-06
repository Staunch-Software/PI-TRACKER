"""Add po_item_entries — line items and additional amounts scraped from SmartPAL's POCreation page.

Revision ID: 0049
Revises: 0048
Create Date: 2026-11-05

"""
from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS po_item_entries (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            smartpal_po_id BIGINT,
            po_no TEXT NOT NULL,
            vessel_name TEXT,
            item_type TEXT NOT NULL DEFAULT 'ITEM',
            account_code TEXT,
            account_code_desc TEXT,
            part_number TEXT,
            item_description TEXT,
            rob NUMERIC,
            unit_price NUMERIC,
            quantity NUMERIC,
            discount_pct NUMERIC,
            total_amount_inr NUMERIC,
            total_amount_usd NUMERIC,
            vat_key TEXT,
            vat_pct NUMERIC,
            sub_account_code TEXT,
            analysis_code TEXT,
            client_code TEXT,
            drawing_no TEXT,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            first_scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_po_item_entries_po_no ON po_item_entries (po_no);
        CREATE INDEX IF NOT EXISTS ix_po_item_entries_account_code ON po_item_entries (account_code);
        CREATE INDEX IF NOT EXISTS ix_po_item_entries_vessel_name ON po_item_entries (vessel_name);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS po_item_entries")
