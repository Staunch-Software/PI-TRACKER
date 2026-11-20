"""Add users.rank column (TSI / TA / None) and backfill existing TSI and TA team members.

Revision ID: 0053
Revises: 0052
Create Date: 2026-11-19
"""
from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS rank TEXT")

    # Backfill known TSI team members
    op.execute(
        """
        UPDATE users
        SET rank = 'TSI'
        WHERE email IN (
            'abhinav.s@ozellar.com',
            'abhishek.s@ozellar.com',
            'gauravsingh.r@ozellar.com',
            'Murtuza@ozellar.com',
            'pavan@ozellar.com'
        )
        """
    )

    # Backfill known TA team members
    op.execute(
        """
        UPDATE users
        SET rank = 'TA'
        WHERE email IN (
            'bharat.n@ozellar.com',
            'gayathri.p@ozellar.com',
            'Jayasri.v@ozellar.com',
            'sunilkumar.s@ozellar.com',
            'viswanathan.n@ozellar.com'
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS rank")
