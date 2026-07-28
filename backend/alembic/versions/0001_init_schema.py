"""Initial schema for PI Follow-up Tracker.

Revision ID: 0001
Revises:
Create Date: 2026-07-21

Enum values here must stay in sync with app/core/enums.py and frontend/src/shared/enums.ts.
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.execute("CREATE TYPE user_role AS ENUM ('ADMIN', 'EDITOR', 'VIEWER')")
    op.execute("CREATE TYPE currency_code AS ENUM ('INR', 'USD', 'EUR')")
    op.execute(
        """
        CREATE TYPE followup_status AS ENUM (
          'PENDING_NOT_YET_FOLLOWED_UP',
          'PENDING_REMINDER_SENT',
          'PENDING_INTERNAL_CHECK',
          'PENDING_DISCREPANCY_TO_RESOLVE',
          'PENDING_SCHEDULED',
          'PENDING_OTHER',
          'RECEIVED',
          'NOT_APPLICABLE'
        )
        """
    )

    op.execute(
        """
        CREATE TABLE users (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email                   CITEXT UNIQUE NOT NULL,
          password_hash           TEXT NOT NULL,
          full_name               TEXT NOT NULL,
          role                    user_role NOT NULL DEFAULT 'VIEWER',
          is_active               BOOLEAN NOT NULL DEFAULT TRUE,
          password_reset_token    TEXT,
          password_reset_expires  TIMESTAMPTZ,
          created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE vessels (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name        TEXT UNIQUE NOT NULL,
          is_active   BOOLEAN NOT NULL DEFAULT TRUE,
          created_by  UUID REFERENCES users(id),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE vendors (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name        TEXT UNIQUE NOT NULL,
          is_active   BOOLEAN NOT NULL DEFAULT TRUE,
          created_by  UUID REFERENCES users(id),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE pi_entries (
          id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          seq_no                  SERIAL,
          dpr_no                  TEXT NOT NULL,
          dpr_date                DATE,
          vessel_id               UUID NOT NULL REFERENCES vessels(id),
          vendor_id               UUID NOT NULL REFERENCES vendors(id),
          service_details         TEXT,
          amount_inr              NUMERIC(14,2),
          fc_amount               NUMERIC(14,2),
          currency                currency_code NOT NULL DEFAULT 'INR',
          payment_date            DATE,
          payment_reference       TEXT,
          followup_status         followup_status NOT NULL DEFAULT 'PENDING_NOT_YET_FOLLOWED_UP',
          last_known_remark       TEXT,
          reminder_1_sent_date    DATE,
          reminder_2_sent_date    DATE,
          final_invoice_received  BOOLEAN NOT NULL DEFAULT FALSE,
          invoice_no              TEXT,
          invoice_date            DATE,
          invoice_file_name       TEXT,
          attached_by             UUID REFERENCES users(id),
          date_attached            TIMESTAMPTZ,
          notes                   TEXT,

          created_by  UUID NOT NULL REFERENCES users(id),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by  UUID REFERENCES users(id),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

          CONSTRAINT uq_pi_entries_dpr_no UNIQUE (dpr_no)
        )
        """
    )

    op.execute("CREATE INDEX idx_pi_entries_status ON pi_entries (followup_status)")
    op.execute("CREATE INDEX idx_pi_entries_vessel ON pi_entries (vessel_id)")
    op.execute("CREATE INDEX idx_pi_entries_vendor ON pi_entries (vendor_id)")
    op.execute("CREATE INDEX idx_pi_entries_payment_date ON pi_entries (payment_date)")

    op.execute(
        """
        CREATE TABLE invoice_attachments (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          pi_entry_id     UUID NOT NULL REFERENCES pi_entries(id) ON DELETE CASCADE,
          blob_container  TEXT NOT NULL DEFAULT 'invoice-attachments',
          blob_key        TEXT NOT NULL,
          file_name       TEXT NOT NULL,
          content_type    TEXT NOT NULL,
          size_bytes      BIGINT NOT NULL,
          uploaded_by     UUID NOT NULL REFERENCES users(id),
          uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_invoice_attachments_pi_entry ON invoice_attachments (pi_entry_id)")

    op.execute(
        """
        CREATE TABLE audit_log (
          id           BIGSERIAL PRIMARY KEY,
          entity_type  TEXT NOT NULL,
          entity_id    UUID NOT NULL,
          action       TEXT NOT NULL,
          changed_by   UUID REFERENCES users(id),
          changes      JSONB,
          summary      TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id)")
    op.execute("CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS invoice_attachments")
    op.execute("DROP TABLE IF EXISTS pi_entries")
    op.execute("DROP TABLE IF EXISTS vendors")
    op.execute("DROP TABLE IF EXISTS vessels")
    op.execute("DROP TABLE IF EXISTS users")
    op.execute("DROP TYPE IF EXISTS followup_status")
    op.execute("DROP TYPE IF EXISTS currency_code")
    op.execute("DROP TYPE IF EXISTS user_role")
