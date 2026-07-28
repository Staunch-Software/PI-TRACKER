"""Per-user read/unread tracking for the Activity Feed.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-21

"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE audit_log_reads (
          audit_log_id  BIGINT NOT NULL REFERENCES audit_log(id) ON DELETE CASCADE,
          user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          read_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (audit_log_id, user_id)
        )
        """
    )
    op.execute("CREATE INDEX idx_audit_log_reads_user ON audit_log_reads (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log_reads")
