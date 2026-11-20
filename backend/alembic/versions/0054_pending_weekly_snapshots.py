"""Create pending_weekly_snapshots table for tracking weekly pending trend snapshots.

Revision ID: 0054
Revises: 0053
Create Date: 2026-11-20
"""
from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_weekly_snapshots (
            id SERIAL PRIMARY KEY,
            week_index INT NOT NULL,
            snapshot_date DATE NOT NULL,
            vessel_name VARCHAR(100) NOT NULL,
            owner_role VARCHAR(10) NOT NULL,
            owner_name VARCHAR(100) NOT NULL,
            requisition_count INT NOT NULL DEFAULT 0,
            po_count INT NOT NULL DEFAULT 0,
            invoice_count INT NOT NULL DEFAULT 0,
            total_count INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_snapshot_week_vessel_role UNIQUE (week_index, vessel_name, owner_role)
        );
        CREATE INDEX IF NOT EXISTS ix_snapshot_week_index ON pending_weekly_snapshots (week_index);
        CREATE INDEX IF NOT EXISTS ix_snapshot_date ON pending_weekly_snapshots (snapshot_date);
        CREATE INDEX IF NOT EXISTS ix_snapshot_vessel ON pending_weekly_snapshots (vessel_name);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pending_weekly_snapshots")
