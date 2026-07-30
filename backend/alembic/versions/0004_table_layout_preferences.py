"""Add table_layout_preferences for per-user column order/width/page-size.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-30

"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE table_layout_preferences (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id),
            table_key TEXT NOT NULL,
            column_order JSONB NOT NULL DEFAULT '[]'::jsonb,
            column_widths JSONB NOT NULL DEFAULT '{}'::jsonb,
            page_size INTEGER,
            updated_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_table_layout_user_table UNIQUE (user_id, table_key)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS table_layout_preferences")
