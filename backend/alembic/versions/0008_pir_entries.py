"""Add pir_entries — SmartPAL 'Problematic Invoice Resolution' scrape target.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-02

Live-snapshot table (upserted by smartpal_invoice_id on every scrape run), not
an append-only log — see app/models/pir_entry.py docstring. Department
(Technical/Manning/Unclassified) is deliberately not a column here — it's
computed at query time by joining vendor_name_normalized against
vendor_department_mapping.
"""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE pir_entries (
          id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          smartpal_invoice_id      INTEGER UNIQUE NOT NULL,
          document_id              INTEGER,
          invoice_no               TEXT,
          reg_invoice_no           TEXT,
          vendor_invoice_no        TEXT,
          vendor_name              TEXT,
          vendor_name_normalized   TEXT,
          vessel_name              TEXT,
          company_name             TEXT,
          vendor_bank_name         TEXT,
          vendor_account_code      TEXT,
          vendor_swift_code        TEXT,
          reg_date                 DATE,
          frwd_from                TEXT,
          amount                   NUMERIC,
          status                   TEXT,
          po_nos                   TEXT,
          currency_code            TEXT,
          total_datapoints         INTEGER,
          available_data_points    INTEGER,
          modified_from_pal        BOOLEAN,
          reject_remark            TEXT,
          raw_json                 JSONB NOT NULL,
          first_scraped_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_pir_entries_smartpal_invoice_id ON pir_entries (smartpal_invoice_id)")
    op.execute("CREATE INDEX ix_pir_entries_vendor_name_normalized ON pir_entries (vendor_name_normalized)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pir_entries")
