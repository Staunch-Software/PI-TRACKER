"""Add vendor_master_entries — the Vendor Management module's scraped SmartPAL vendor master
(list-scrape columns, populated nightly for all ~1,098 fleet vendors, plus detail-scrape columns
populated on-demand only once a vendor is added to the tracker).

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-30

"""
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE vendor_master_entries (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          vendor_code         TEXT NOT NULL UNIQUE,
          vendor_name         TEXT,
          vendor_type         TEXT,
          email               TEXT,
          currency            TEXT,
          city                TEXT,
          country             TEXT,
          state               TEXT,
          active              BOOLEAN,
          raw_json            JSONB NOT NULL,

          address             TEXT,
          phone_1             TEXT,
          phone_2             TEXT,
          fax_1               TEXT,
          fax_2               TEXT,
          telex               TEXT,
          website             TEXT,
          zip_code            TEXT,
          contacts            JSONB NOT NULL DEFAULT '[]'::jsonb,
          detail_scraped_at   TIMESTAMPTZ,

          first_scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_vendor_master_entries_vendor_code ON vendor_master_entries (vendor_code)")
    op.execute("CREATE INDEX ix_vendor_master_entries_vendor_name ON vendor_master_entries (vendor_name)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_master_entries")
