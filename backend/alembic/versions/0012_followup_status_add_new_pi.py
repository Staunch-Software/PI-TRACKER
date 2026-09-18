"""Add ADD_NEW_PI to the followup_status enum — lets "Add New PI" be picked directly from the
per-row Follow-up Status dropdown while adding/editing a pi_entries row.

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-18

"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE followup_status ADD VALUE IF NOT EXISTS 'ADD_NEW_PI'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enum types — removing a value would require rebuilding the
    # type (create new type, migrate the column, drop old type). Not attempted here.
    pass
