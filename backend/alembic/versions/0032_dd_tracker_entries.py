"""Add dd_tracker_entries — the manually-curated DD Tracker module rows (team follow-up notes
layered over the scraped pr_entries/po_entries, joined at read time by requisition_no/po_no).

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-27

"""
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE dd_tracker_entries (
          id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seq_no                 SERIAL,

          entry_type             TEXT,
          requisition_no         TEXT,
          po_no                  TEXT,
          vessel_name            TEXT,
          title                  TEXT,

          pr_status              TEXT,
          order_status           TEXT,
          lead_days              INTEGER,
          readiness_date         DATE,
          ex_stock               TEXT,
          supply_confirmation    TEXT,
          remarks_1              TEXT,
          remarks_2              TEXT,
          invoice_number         TEXT,
          invoice_type           TEXT,
          invoice_amount         NUMERIC,
          invoice_currency       TEXT,
          payment_status         TEXT,

          created_by             UUID REFERENCES users(id),
          updated_by             UUID REFERENCES users(id),
          created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_dd_tracker_entries_requisition_no ON dd_tracker_entries (requisition_no)")
    op.execute("CREATE INDEX ix_dd_tracker_entries_po_no ON dd_tracker_entries (po_no)")
    op.execute("CREATE INDEX ix_dd_tracker_entries_vessel_name ON dd_tracker_entries (vessel_name)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS dd_tracker_entries")
