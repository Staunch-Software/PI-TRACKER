"""Add per-user module access flags (can_access_pi, can_access_pir) to users.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-02

Both default TRUE so every existing user keeps full access on upgrade — this is an
additive access-narrowing feature, not something that should silently lock anyone
out. Admin role always has full access regardless of these flags (enforced in
app/api/deps.py, not in the DB) — see AdminUsersPage.tsx / UserModal.tsx, which
disable-and-check these boxes for Admin rows so that's visible in the UI too.
"""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN can_access_pi BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE users ADD COLUMN can_access_pir BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN can_access_pi")
    op.execute("ALTER TABLE users DROP COLUMN can_access_pir")
