from datetime import datetime

from sqlalchemy import DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class SoaVendorDomainAlias(Base):
    """Maps a sender domain to the CANONICAL domain it should be treated as the same vendor as,
    for SOA versioning/supersession purposes (see SoaDocument.canonical_domain).

    Confirmed live: the real vendor Navarino sends SOAs from two different domains for the same
    underlying account — andreas.tanios@navarino.gr (an individual) and
    collections@navarino.com.cy (the AR team) — both listing the SAME invoice numbers/amounts.
    Without this table, sender_domain alone treats them as two unrelated vendors, so neither ever
    supersedes the other and every invoice gets double-counted in KPIs/matching.

    Deliberately a small hand-curated table (added to as duplicates are spotted, same "small
    curated list" convention as vendor_department_mapping's Manning allowlist), NOT an automatic
    fuzzy-match on vendor name — guessing two domains are "the same vendor" from name similarity
    risks silently merging two actually-different vendors and losing one's invoices to the
    other's supersession. No admin UI yet; add rows directly (see 0014 migration for the seed
    example) until this is common enough to justify one.
    """

    __tablename__ = "soa_vendor_domain_aliases"

    alias_domain: Mapped[str] = mapped_column(Text, primary_key=True)
    canonical_domain: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
