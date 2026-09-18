"""Add vendor_department_mapping for the admin Vendor Mapping module.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-01

Enum values here must stay in sync with app/core/enums.py and frontend/src/shared/enums.ts.
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE vendor_department AS ENUM ('TECHNICAL', 'MANNING')")

    op.execute(
        """
        CREATE TABLE vendor_department_mapping (
          id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vendor_name              TEXT NOT NULL,
          vendor_name_normalized   TEXT UNIQUE NOT NULL,
          department               vendor_department NOT NULL,
          active                   BOOLEAN NOT NULL DEFAULT TRUE,
          created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_department_mapping")
    op.execute("DROP TYPE IF EXISTS vendor_department")
