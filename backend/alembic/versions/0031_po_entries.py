"""Add po_entries — scraped SmartPAL Purchase Orders (Purchase > PO Overview, "All" tab),
feeding the new DD Tracker module.

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-27

"""
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE po_entries (
          id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          smartpal_id        BIGINT NOT NULL,
          po_no              TEXT UNIQUE NOT NULL,
          requisition_no     TEXT,

          title              TEXT,
          vessel_name        TEXT,
          vendor             TEXT,
          req_category       TEXT,
          po_type            TEXT,

          base_amount        NUMERIC,
          base_currency      TEXT,

          approved_status    TEXT,
          invoice_status     TEXT,
          po_sent            BOOLEAN,

          created_date       DATE,
          approved_date      DATE,
          confirmed_date     DATE,

          schd_del_port      TEXT,
          agent_name         TEXT,
          warehouse_name     TEXT,
          grn_nos            TEXT,
          do_nos             TEXT,
          remarks            TEXT,

          pending_days       INTEGER,
          priority           TEXT,
          critical           BOOLEAN,

          raw_json           JSONB NOT NULL,

          first_scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_po_entries_smartpal_id ON po_entries (smartpal_id)")
    op.execute("CREATE INDEX ix_po_entries_requisition_no ON po_entries (requisition_no)")
    op.execute("CREATE INDEX ix_po_entries_vessel_name ON po_entries (vessel_name)")
    op.execute("CREATE INDEX ix_po_entries_req_category ON po_entries (req_category)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS po_entries")
