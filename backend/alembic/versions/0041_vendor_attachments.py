"""Add vendor_master_attachments (scraper-downloaded SmartPAL vendor documents) and
vendor_bank_attachments (user-uploaded bank-details-reply documents) — kept as two separate
tables since they have different parents/lifecycles/metadata shapes, same stance as not merging
invoice_attachments with anything else.

Revision ID: 0041
Revises: 0040
Create Date: 2026-10-30

"""
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE vendor_master_attachments (
          id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vendor_code           TEXT NOT NULL,

          blob_container        TEXT NOT NULL DEFAULT 'vendor-attachments',
          blob_key              TEXT NOT NULL,
          file_name             TEXT NOT NULL,
          content_type          TEXT NOT NULL,
          size_bytes            BIGINT NOT NULL,

          smartpal_uploaded_by  TEXT,
          smartpal_uploaded_at  TEXT,
          raw_json              JSONB NOT NULL,

          downloaded_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_vendor_master_attachments_vendor_code ON vendor_master_attachments (vendor_code)")

    op.execute(
        """
        CREATE TABLE vendor_bank_attachments (
          id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          vendor_tracker_entry_id   UUID NOT NULL REFERENCES vendor_tracker_entries(id) ON DELETE CASCADE,

          blob_container            TEXT NOT NULL DEFAULT 'vendor-attachments',
          blob_key                  TEXT NOT NULL,
          file_name                 TEXT NOT NULL,
          content_type              TEXT NOT NULL,
          size_bytes                BIGINT NOT NULL,
          uploaded_by               UUID NOT NULL REFERENCES users(id),
          uploaded_at               TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_vendor_bank_attachments_entry_id ON vendor_bank_attachments (vendor_tracker_entry_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_bank_attachments")
    op.execute("DROP TABLE IF EXISTS vendor_master_attachments")
