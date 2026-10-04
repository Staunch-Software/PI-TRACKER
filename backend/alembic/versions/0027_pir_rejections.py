"""Add pir_rejections — who rejected each PIR invoice and when, scraped from the Problematic
Invoice Overview page's "Rejected invoice" category via each row's Audit Trial icon.

Revision ID: 0027
Revises: 0026
Create Date: 2026-10-02
"""
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE pir_rejections (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          smartpal_invoice_id   INTEGER UNIQUE NOT NULL,
          invoice_no            TEXT,

          rejected_by           TEXT,
          rejected_date         TIMESTAMPTZ,
          remarks               TEXT,

          raw_json              JSONB NOT NULL,

          first_scraped_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_pir_rejections_rejected_by ON pir_rejections (rejected_by)")
    op.execute("CREATE INDEX ix_pir_rejections_rejected_date ON pir_rejections (rejected_date)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pir_rejections")
