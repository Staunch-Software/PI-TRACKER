import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from app.db.base import Base


class PirEntry(Base):
    """One row per SmartPAL 'Problematic Invoice Resolution' invoice (Accounts >
    I2P > Problematic Invoice Overview). Scraped by
    app/services/pir_scraper/scraper.py directly from SmartPAL's own JSON API
    (api/ServiceRouter/GET?pData=pCategoryId=-1&...) rather than the Kendo grid
    DOM — that endpoint returns the full row set as clean JSON with no
    pagination/virtual-scroll quirks to fight, unlike the bunker report scraper
    this was modeled after.

    This is a LIVE snapshot table, not an append-only transaction log like
    mariapps_bunker_reports in Vessel_Performance — a "problematic" invoice's
    fields (PO, vessel, amount) can be corrected in SmartPAL after the fact, so
    every scrape run UPSERTS by smartpal_invoice_id rather than skip-if-seen.

    Department (Technical/Manning/Unclassified) is deliberately NOT stored here
    — it's computed live by joining vendor_name_normalized against
    vendor_department_mapping (see api routes), the same "computed at query
    time, not stored" convention pi_entries.days_since_payment already uses, so
    a vendor-mapping edit reclassifies existing PIR rows immediately.

    IMPORTANT — vendor_department_mapping is a MANNING ALLOWLIST, not a full
    directory: Manning vendors are a small curated list (~28 as of 2026-09-02,
    added by hand via the admin panel), while Technical vendors number 1000+
    and are never individually mapped. So the classification default flips —
    a vendor found (active) in vendor_department_mapping takes that row's
    department; everything else defaults to TECHNICAL, not UNCLASSIFIED.
    UNCLASSIFIED should only apply when vendor_name itself is null/blank (the
    row genuinely has nothing to classify by) — confirmed live: of 1881
    scraped rows, 183 matched the Manning allowlist, 1 had a null vendor_name,
    and the remaining 1697 correctly default to Technical. A query building
    this must cast the enum column first — `COALESCE(m.department::text,
    'TECHNICAL')` — bare COALESCE against the vendor_department enum column
    rejects a 'TECHNICAL'/'UNCLASSIFIED' text literal with an
    InvalidTextRepresentation error since those aren't values of that pg enum
    type (confirmed live).

    SmartPAL's own facet counts (Vessel not assigned / Vendor not assigned / PO
    not found / Potential duplicate / etc., visible in the left sidebar of the
    PIR page) are NOT captured — confirmed via SmartPAL's own JS
    (problematicinvoiceoverview.js) that these require separate per-category API
    calls against SmartPAL's internal matching logic (e.g. "Vendor not
    assigned" is NOT simply vendor_name being blank — in a live pull, 449 rows
    were flagged "Vendor not assigned" while vendor_name was non-blank on every
    single row). Out of scope for this scraper; see CLAUDE.md/PR notes.

    SmartPAL's internal category codes (pCategoryId, captured live 2026-09-02 via network
    capture while clicking through every sidebar category), kept here purely as reference in
    case a future feature needs them for DISPLAY — NOT for deep-linking, see below:
        All = -1, Vessel not assigned = 1, Vendor not assigned = 2, PO not found = 3,
        Post invoice PO = 4, Potential duplicate = 5, PO Closed = 6, PO unapproved = 7,
        Currency Mismatch = 8, Mandatory data points missing = 0 (anomalous — unlike every other
        category, its main grid-data call fires with an EMPTY pData, carrying no pCategoryId at
        all; the two companion INV/POS calls do show 0, but this one is worth re-checking if it's
        ever load-bearing), Hold Invoice = -10, Rejected invoice = -100.

    Deep-linking to a category (or an invoice — see smartpal_deep_link discussion in
    PirInvoiceTable.tsx) does NOT work: confirmed live (2026-09-02) that appending
    ?pCategoryId=N to the Overview page's URL and doing a FRESH navigation is silently ignored —
    the actual grid-data-fetching call that fires on load always carries pCategoryId=-1 (All),
    and the sidebar highlights "All" as active, not the requested category. Same failure mode as
    the earlier confirmed invoice-level test (?pInvoiceId=... also loads a blank/unfiltered
    shell). Category selection only ever happens via an in-page click that updates in-memory
    JS/Knockout observables — never the URL — so there is no server-side "give me this filtered
    view" endpoint to link to from outside the app.
    """

    __tablename__ = "pir_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())

    # SmartPAL's own internal invoice id ("id" in the JSON) — the real unique key
    # for this record and what its "Invoice No." link/detail screen key off of.
    smartpal_invoice_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    # SmartPAL's internal document reference ("documentId" in the JSON) — kept for
    # a future attachment/detail lookup; not confirmed to expose a downloadable
    # file from this list view (see model docstring / PR notes).
    document_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    reg_invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_invoice_no: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Case/whitespace/punctuation-insensitive key, same normalization as
    # vendor_department_mapping.vendor_name_normalized — used to join and
    # classify Technical/Manning/Unclassified at query time.
    vendor_name_normalized: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)

    vessel_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Manual override for the "Assign vessel" action — deliberately a SEPARATE column from
    # vessel_name, never touched by the scraper's upsert (see class docstring), so assigning a
    # vessel survives the next scrape instead of being overwritten by whatever SmartPAL has.
    # Takes precedence over vessel_name matching when set (see pir_vessel_matcher.py callers).
    assigned_vessel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=True)
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor_bank_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_account_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_swift_code: Mapped[str | None] = mapped_column(Text, nullable=True)

    reg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    frwd_from: Mapped[str | None] = mapped_column(Text, nullable=True)  # meaning unconfirmed — kept as-is from source
    amount: Mapped[Decimal | None] = mapped_column(Numeric, nullable=True)
    status: Mapped[str | None] = mapped_column(Text, nullable=True)  # always null in a live pull; kept for forward-compat
    po_nos: Mapped[str | None] = mapped_column(Text, nullable=True)  # SmartPAL's own field name (plural — can list >1 PO)
    currency_code: Mapped[str | None] = mapped_column(Text, nullable=True)

    total_datapoints: Mapped[int | None] = mapped_column(Integer, nullable=True)
    available_data_points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    modified_from_pal: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reject_remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    raw_json: Mapped[dict] = mapped_column(JSONB, nullable=False)  # full scraped row, for debugging/forward-compat

    # Bookkeeping for the live-snapshot/upsert model (see class docstring) — distinct
    # from any SmartPAL-side timestamp, since SmartPAL doesn't expose a reliable
    # "last modified" field on this endpoint to upsert against.
    first_scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_scraped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
