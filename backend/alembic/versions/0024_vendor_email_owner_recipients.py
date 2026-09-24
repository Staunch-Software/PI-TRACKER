"""Add vendors.email (contact for the automated "send vendor notice" email) and owner_recipients
(admin-managed list of email addresses that receive the "send owner reminder" email — one flat
list, not per-vessel, since all vessels share the same owner per the user).

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-23

"""
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE vendors ADD COLUMN email TEXT")

    op.execute(
        """
        CREATE TABLE owner_recipients (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name        TEXT,
          email       TEXT UNIQUE NOT NULL,
          is_active   BOOLEAN NOT NULL DEFAULT TRUE,
          created_by  UUID REFERENCES users(id),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS owner_recipients")
    op.execute("ALTER TABLE vendors DROP COLUMN IF EXISTS email")
