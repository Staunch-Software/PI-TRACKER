"""Add assigned_vessel_id to pir_entries — a manual override for the "Assign vessel ▾" action,
kept as a SEPARATE column from the scraped vessel_name (never touched by
app/services/pir_scraper/scraper.py's upsert, which overwrites vessel_name from SmartPAL on
every run) so a manual assignment survives the next scrape instead of being clobbered by it.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-03

"""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE pir_entries ADD COLUMN assigned_vessel_id UUID REFERENCES vessels(id)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE pir_entries DROP COLUMN assigned_vessel_id")
