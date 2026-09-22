"""Fix Navarino (and any future) duplicate-vendor issue in SOA reconciliation: adds
soa_vendor_domain_aliases (small hand-curated table mapping a sender domain to the canonical
domain it should be treated as the same vendor as — see SoaVendorDomainAlias docstring) and
soa_documents.canonical_domain (the resolved key actually used for supersession, see
SoaDocument docstring), backfilling existing rows and collapsing any resulting duplicate
"current" documents per canonical vendor down to the most recent one.

Confirmed live: Navarino sent identical invoices from both navarino.gr and navarino.com.cy,
which compared as two different vendors under sender_domain alone, so BOTH stayed "current" and
their shared invoices were double-counted.

Revision ID: 0021
Revises: 0020
Create Date: 2026-09-22

"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE soa_vendor_domain_aliases (
          alias_domain      TEXT PRIMARY KEY,
          canonical_domain  TEXT NOT NULL,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "INSERT INTO soa_vendor_domain_aliases (alias_domain, canonical_domain) VALUES ('navarino.gr', 'navarino.com.cy')"
    )

    op.execute("ALTER TABLE soa_documents ADD COLUMN canonical_domain TEXT")
    op.execute(
        """
        UPDATE soa_documents sd
        SET canonical_domain = COALESCE(
            (SELECT a.canonical_domain FROM soa_vendor_domain_aliases a WHERE a.alias_domain = sd.sender_domain),
            sd.sender_domain
        )
        """
    )
    op.execute("ALTER TABLE soa_documents ALTER COLUMN canonical_domain SET NOT NULL")
    op.execute("CREATE INDEX ix_soa_documents_canonical_domain ON soa_documents (canonical_domain)")
    op.execute("CREATE INDEX ix_soa_documents_canonical_current ON soa_documents (canonical_domain, is_current)")

    # Collapse any pre-existing duplicate "current" documents per canonical vendor (the Navarino
    # case, and any other domain pair this migration's alias table maps together) down to the
    # single most-recently-received one — same rule ingest.py applies going forward.
    op.execute(
        """
        WITH ranked AS (
          SELECT id, canonical_domain,
                 ROW_NUMBER() OVER (PARTITION BY canonical_domain ORDER BY received_at DESC) AS rn
          FROM soa_documents
          WHERE is_current = TRUE
        )
        UPDATE soa_documents
        SET is_current = FALSE
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE soa_documents DROP COLUMN IF EXISTS canonical_domain")
    op.execute("DROP TABLE IF EXISTS soa_vendor_domain_aliases")
