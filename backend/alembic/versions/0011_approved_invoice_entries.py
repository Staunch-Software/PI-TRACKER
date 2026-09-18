"""Add approved_invoice_entries — AMNS-fleet "Finally Approved" invoices scraped from SmartPAL
(Purchase > Transactions > Invoice Approval, Purchase/InvoiceList tab FNL), with our own
payment_status (Paid/Not Paid) tracked per row, independent of anything SmartPAL scrapes.

Revision ID: 0011
Revises: 0010
Create Date: 2026-09-09

"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE payment_status AS ENUM ('PAID', 'NOT_PAID')")
    op.execute(
        """
        CREATE TABLE approved_invoice_entries (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          -- SmartPAL's own internal invoice id ("id" in the JSON) — the real unique key.
          smartpal_invoice_id   INTEGER UNIQUE NOT NULL,

          invoice_no            TEXT,
          vendor_invoice_no     TEXT,
          vendor_name           TEXT,

          -- Raw SmartPAL vessel name, kept alongside the resolved FK — only 4 known AMNS
          -- vessels feed this table, so unlike PIR this is a plain exact match, not fuzzy.
          vessel_name           TEXT,
          vessel_id             UUID REFERENCES vessels(id),

          amount                NUMERIC,
          currency_code         TEXT,
          po_nos                TEXT,
          category_name         TEXT,
          status                TEXT,               -- SmartPAL's own status text ("Finally Approved")
          invoice_date          DATE,                -- SmartPAL's "invDate"
          forward_date          TIMESTAMPTZ,          -- SmartPAL's "forwardDate" (approval timestamp)
          attachment            BOOLEAN,
          grn_exists            BOOLEAN,

          -- Ours — not scraped, never overwritten by the scraper's upsert.
          payment_status        payment_status NOT NULL DEFAULT 'NOT_PAID',

          raw_json              JSONB NOT NULL,

          first_scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_approved_invoice_entries_vessel_id ON approved_invoice_entries (vessel_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS approved_invoice_entries")
    op.execute("DROP TYPE IF EXISTS payment_status")
