"""Add SOA reconciliation module: soa_documents/soa_line_items (SOA emails, versioned by
sender/vendor with soft-delete on supersession), invoice_mail_entries (invoice@ mailbox
extraction), and smartpal_invoice_entries (all-status SmartPAL invoice snapshot, the 1st-priority
SOA match source — see model docstrings for why this is separate from approved_invoice_entries).

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-22

"""
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE soa_match_source AS ENUM ('SMARTPAL', 'PIR', 'INVOICE_MAIL', 'NONE')")

    op.execute(
        """
        CREATE TABLE soa_documents (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          graph_message_id  TEXT UNIQUE NOT NULL,
          mailbox           TEXT NOT NULL,
          sender_email      TEXT NOT NULL,
          sender_name       TEXT,
          sender_domain     TEXT NOT NULL,
          vendor_name_raw   TEXT,

          subject           TEXT,
          received_at       TIMESTAMPTZ NOT NULL,

          is_current        BOOLEAN NOT NULL DEFAULT TRUE,

          ingested_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_soa_documents_sender_email ON soa_documents (sender_email)")
    op.execute("CREATE INDEX ix_soa_documents_sender_domain ON soa_documents (sender_domain)")
    # The query that finds "the current SOA to supersede for this vendor" filters on
    # (sender_domain, is_current) — index the pair directly.
    op.execute("CREATE INDEX ix_soa_documents_domain_current ON soa_documents (sender_domain, is_current)")

    op.execute(
        """
        CREATE TABLE soa_line_items (
          id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          soa_document_id           UUID NOT NULL REFERENCES soa_documents(id) ON DELETE CASCADE,

          invoice_number            TEXT NOT NULL,
          invoice_number_normalized TEXT NOT NULL,

          invoice_date              DATE,
          amount                    NUMERIC,
          remaining_amount          NUMERIC,
          currency                  TEXT,

          vessel_name_raw           TEXT,
          vessel_id                 UUID REFERENCES vessels(id),

          match_source              soa_match_source NOT NULL DEFAULT 'NONE',
          match_status_label        TEXT,
          matched_entry_id          UUID,
          matched_at                TIMESTAMPTZ,

          raw_json                  JSONB NOT NULL,

          created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_soa_line_items_soa_document_id ON soa_line_items (soa_document_id)")
    op.execute("CREATE INDEX ix_soa_line_items_invoice_number_normalized ON soa_line_items (invoice_number_normalized)")

    op.execute(
        """
        CREATE TABLE invoice_mail_entries (
          id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          graph_message_id          TEXT NOT NULL,
          sender_email              TEXT NOT NULL,
          subject                   TEXT,
          received_at                TIMESTAMPTZ NOT NULL,

          invoice_number            TEXT NOT NULL,
          invoice_number_normalized TEXT NOT NULL,
          invoice_date              DATE,
          amount                    NUMERIC,
          currency                  TEXT,

          vendor_name_raw           TEXT,
          vessel_name_raw           TEXT,
          vessel_id                 UUID REFERENCES vessels(id),

          raw_json                  JSONB NOT NULL,

          ingested_at               TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_invoice_mail_entries_graph_message_id ON invoice_mail_entries (graph_message_id)")
    op.execute("CREATE INDEX ix_invoice_mail_entries_invoice_number_normalized ON invoice_mail_entries (invoice_number_normalized)")

    op.execute(
        """
        CREATE TABLE smartpal_invoice_entries (
          id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

          smartpal_invoice_id    INTEGER UNIQUE NOT NULL,

          invoice_no             TEXT,
          invoice_no_normalized  TEXT,
          vendor_invoice_no      TEXT,
          vendor_name            TEXT,

          vessel_name            TEXT,
          vessel_id              UUID REFERENCES vessels(id),

          amount                 NUMERIC,
          currency_code          TEXT,
          invoice_date           DATE,

          status                 TEXT,

          raw_json               JSONB NOT NULL,

          first_scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_scraped_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_smartpal_invoice_entries_invoice_no_normalized ON smartpal_invoice_entries (invoice_no_normalized)")
    op.execute("CREATE INDEX ix_smartpal_invoice_entries_vessel_id ON smartpal_invoice_entries (vessel_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS smartpal_invoice_entries")
    op.execute("DROP TABLE IF EXISTS invoice_mail_entries")
    op.execute("DROP TABLE IF EXISTS soa_line_items")
    op.execute("DROP TABLE IF EXISTS soa_documents")
    op.execute("DROP TYPE IF EXISTS soa_match_source")
