"""Add vendor_detail_bulk_scrape_runs — tracks progress of the "Scrape All Vendor Details"
background job (All Vendors tab), one row per run. Needed because production runs multiple
gunicorn worker processes, so an in-memory progress counter wouldn't be visible across requests.
See services/vendor_master_scraper/detail_scraper.py's run_bulk_detail_scrape().

Revision ID: 0047
Revises: 0046
Create Date: 2026-11-04

"""
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE vendor_detail_bulk_scrape_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL DEFAULT 'running',
            total INTEGER NOT NULL DEFAULT 0,
            completed INTEGER NOT NULL DEFAULT 0,
            succeeded INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            current_vendor_code TEXT,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_by UUID REFERENCES users(id),
            finished_at TIMESTAMPTZ
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_detail_bulk_scrape_runs")
