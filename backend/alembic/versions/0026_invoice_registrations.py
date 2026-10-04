"""Add invoice_registrations — who registered each SmartPAL invoice and when, scraped from the
per-invoice "Pending List" approval chain (Purchase > Invoice Approval), filtered to the
"Registered" status row. Covers all invoices/vessels/categories, not just the AMNS Finally
Approved subset approved_invoice_entries tracks.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-29
"""
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE invoice_registrations (
          id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          smartpal_invoice_id      INTEGER UNIQUE NOT NULL,
          invoice_no               TEXT,

          registered_by            TEXT,
          registered_action_date   TIMESTAMPTZ,

          raw_json                 JSONB NOT NULL,

          first_scraped_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_invoice_registrations_registered_by ON invoice_registrations (registered_by)")
    op.execute("CREATE INDEX ix_invoice_registrations_registered_action_date ON invoice_registrations (registered_action_date)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS invoice_registrations")
