"""Add vendor_bank_details — read-only mirror of a vendor's SmartPAL Bank Details tab rows,
populated by the on-demand detail scrape (delete+reinserted per vendor_code on each scrape).

Revision ID: 0039
Revises: 0038
Create Date: 2026-10-30

"""
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE vendor_bank_details (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vendor_code       TEXT NOT NULL,

          beneficiary_name  TEXT,
          branch_name       TEXT,
          bank_name         TEXT,
          country           TEXT,
          bank_code         TEXT,
          currency          TEXT,
          account_number    TEXT,
          iban              TEXT,
          swift_code        TEXT,
          aba_no            TEXT,
          is_default        BOOLEAN NOT NULL DEFAULT FALSE,
          is_active         BOOLEAN NOT NULL DEFAULT TRUE,
          raw_json          JSONB NOT NULL,

          scraped_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_vendor_bank_details_vendor_code ON vendor_bank_details (vendor_code)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_bank_details")
