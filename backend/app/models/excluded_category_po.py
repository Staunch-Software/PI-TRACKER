from datetime import datetime
from sqlalchemy import Column, DateTime, String
from app.db.base import Base


class ExcludedCategoryPo(Base):
    """Lightweight lookup of PO numbers whose req_category is one of po_scraper.py's
    _EXCLUDED_CATEGORIES (crew wages/expenses) — those PO/PR rows are never stored in
    po_entries/pr_entries at all (confirmed with the user as never relevant to this app), so
    there'd otherwise be no way to tell a Pending/Approved invoice linked to one of these POs
    apart from any other invoice. Populated by po_scraper.py's own exclusion check at scrape
    time (see _run_po) instead of fully storing these PO rows, which would re-expose them to
    DD/PD Tracker's auto-sync, Vendor Management filters, etc. — this table exists purely so
    the Pending Items dashboard can exclude their invoices too (see pending_items.py's
    _compute_pending_items)."""

    __tablename__ = "excluded_category_pos"

    po_no = Column(String(100), primary_key=True)
    req_category = Column(String(200), nullable=True)
    last_seen_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
