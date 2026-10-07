"""Add landing_reports table for the Landing Reports module.

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-07

"""
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE landing_reports (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seq_no           SERIAL,
          vessel_id        UUID NOT NULL REFERENCES vessels(id),
          port             TEXT,
          oil_type         TEXT NOT NULL,
          offlanded_date   DATE,
          shipment_status  TEXT,
          report_status    TEXT,
          created_by       UUID REFERENCES users(id),
          created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_landing_reports_vessel_id ON landing_reports (vessel_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS landing_reports")
