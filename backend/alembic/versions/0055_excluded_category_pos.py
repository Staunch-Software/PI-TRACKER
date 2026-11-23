"""Create excluded_category_pos table — lookup of PO numbers in crew categories (po_scraper.py's
_EXCLUDED_CATEGORIES) that are never stored in po_entries, so invoices linked to them can still
be excluded from the Pending Items dashboard.

Revision ID: 0055
Revises: 0054
Create Date: 2026-11-23
"""
from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS excluded_category_pos (
            po_no VARCHAR(100) PRIMARY KEY,
            req_category VARCHAR(200),
            last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS excluded_category_pos")
