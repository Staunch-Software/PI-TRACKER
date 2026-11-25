"""Create user_sessions table for per-browser/device session revocation on logout.

Revision ID: 0058
Revises: 0057
Create Date: 2026-11-25
"""
from alembic import op

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_sessions (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at  TIMESTAMPTZ NOT NULL,
            revoked_at  TIMESTAMPTZ,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_user_sessions_user_id ON user_sessions (user_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_sessions")
