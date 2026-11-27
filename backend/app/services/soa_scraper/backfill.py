# ===========================================================================
# backend/app/services/soa_scraper/backfill.py
#
# One-off historical catch-up: the regular 4-hourly poll (ingest.py) only ever looks at each
# mailbox's most recent `top=25` messages (see ms_graph_client.list_recent_messages), so any SOA
# mail older than that window — present before this pipeline went live, or pushed past position
# 25 by other inbox traffic — is never seen by the regular timer. This script runs the exact same
# ingest_soa_mailbox/ingest_invoice_mailbox logic with a much larger `top`, which now paginates
# through each mailbox's message history via Graph's @odata.nextLink (see
# ms_graph_client.list_recent_messages). Safe to run repeatedly, or alongside the regular timer:
# it relies on the exact same graph_message_id / internet_message_id dedupe as a normal poll, so
# nothing already ingested is re-created or re-superseded.
#
# Usage (from backend/):
#   python -m app.services.soa_scraper.backfill [top]
#       top: how far back into each mailbox's history to scan, newest-first (default 2000). Raise
#       it further if a mailbox has more total messages than that and older SOA mail still isn't
#       showing up afterwards.
# ===========================================================================
import logging
import sys

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.soa_vendor_domain_alias import SoaVendorDomainAlias
from app.models.vessel import Vessel
from app.services.pir_vessel_matcher import normalize_vessel_name
from app.services.soa_scraper.ingest import ingest_invoice_mailbox, ingest_soa_mailbox
from app.services.soa_scraper.matching import rematch_all_current_line_items
from app.services.soa_scraper.ms_graph_client import MsGraphClient

log = logging.getLogger(__name__)

_DEFAULT_TOP = 2000


def main(top: int) -> None:
    client = MsGraphClient()
    db = SessionLocal()
    try:
        vessel_cache = {
            normalize_vessel_name(name): str(vessel_id)
            for vessel_id, name in db.execute(select(Vessel.id, Vessel.name)).all()
        }
        alias_cache = dict(
            db.execute(select(SoaVendorDomainAlias.alias_domain, SoaVendorDomainAlias.canonical_domain)).all()
        )

        for mailbox in settings.soa_mailboxes:
            print(f"Backfilling SOA mailbox {mailbox} (scanning up to {top} message(s))...")
            try:
                new_count = ingest_soa_mailbox(db, client, mailbox, vessel_cache, alias_cache, top=top)
            except Exception:
                log.exception("Failed backfilling SOA mailbox %s", mailbox)
                continue
            print(f"  {new_count} new SOA document(s).")

        print(f"Backfilling invoice mailbox {settings.invoice_mailbox} (scanning up to {top} message(s))...")
        try:
            new_count = ingest_invoice_mailbox(db, client, settings.invoice_mailbox, vessel_cache, top=top)
            print(f"  {new_count} new invoice mail entrie(s).")
        except Exception:
            log.exception("Failed backfilling invoice mailbox %s", settings.invoice_mailbox)

        print("Running match pass...")
        rematch_all_current_line_items(db)
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    main(int(sys.argv[1]) if len(sys.argv) > 1 else _DEFAULT_TOP)
