"""Add pr_entries — scraped SmartPAL Purchase Requisitions (Purchase > Requisition Approval,
"All" tab), feeding the new DD Tracker module.

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-27

"""
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE pr_entries (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          smartpal_id        BIGINT NOT NULL,
          requisition_no     TEXT UNIQUE NOT NULL,

          title              TEXT,
          vessel_name        TEXT,
          req_category       TEXT,
          department         TEXT,
          status             TEXT,
          priority           TEXT,
          critical           BOOLEAN,
          created_by         TEXT,
          created_date       DATE,
          approved_date      DATE,
          received_date      DATE,
          pending_since      INTEGER,
          item_count         INTEGER,
          required_before    DATE,

          raw_json           JSONB NOT NULL,

          first_scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_pr_entries_smartpal_id ON pr_entries (smartpal_id)")
    op.execute("CREATE INDEX ix_pr_entries_vessel_name ON pr_entries (vessel_name)")
    op.execute("CREATE INDEX ix_pr_entries_req_category ON pr_entries (req_category)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pr_entries")
