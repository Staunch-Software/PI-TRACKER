"""Add vendor_tracker_entries — the Vendor Management module's tracked-vendor rows (bank-details-
request workflow, manually-keyed bank overrides, bank verification flag). Joins live against
vendor_master_entries.vendor_code at read time, same "join live, don't duplicate" stance as
DD Tracker.

Revision ID: 0040
Revises: 0039
Create Date: 2026-10-30

"""
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE vendor_tracker_entries (
          id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seq_no                           SERIAL,

          vendor_code                      TEXT NOT NULL UNIQUE,

          bank_details_status              TEXT NOT NULL DEFAULT 'missing',
          bank_request_sent_at             TIMESTAMPTZ,
          bank_request_sent_by             UUID REFERENCES users(id),
          bank_details_received_at         TIMESTAMPTZ,
          bank_details_received_by         UUID REFERENCES users(id),
          bank_details_updated_at          TIMESTAMPTZ,
          bank_details_updated_by          UUID REFERENCES users(id),

          bank_beneficiary_name            TEXT,
          bank_name                        TEXT,
          bank_branch_name                 TEXT,
          bank_account_number              TEXT,
          bank_iban                        TEXT,
          bank_swift_code                  TEXT,

          bank_verification_completed      BOOLEAN NOT NULL DEFAULT FALSE,
          bank_verification_completed_by   UUID REFERENCES users(id),
          bank_verification_completed_at   TIMESTAMPTZ,

          created_by                       UUID REFERENCES users(id),
          updated_by                       UUID REFERENCES users(id),
          created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_vendor_tracker_entries_vendor_code ON vendor_tracker_entries (vendor_code)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS vendor_tracker_entries")
