import uuid
from collections import Counter

from sqlalchemy import text
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import require_module_access, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.pir_entry import PirEntry
from app.models.user import User
from app.models.vessel import Vessel
from app.schemas.common import PaginatedResult
from app.schemas.pir_entry import (
    AssignVesselRequest,
    PirDepartmentCounts,
    PirEntryOut,
    PirKpisOut,
)
from app.services.audit import write_audit_log
from app.services.pir_vessel_matcher import NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP, resolve_vessel_group

router = APIRouter(prefix="/pir-entries", tags=["pir-entries"])

# Department is computed here, not stored on pir_entries — see app/models/pir_entry.py
# docstring for why: vendor_department_mapping is a MANNING ALLOWLIST (a small curated list),
# not a full vendor directory, so a vendor matched there wins; everything else with a vendor
# name defaults to TECHNICAL (the 1000+ long tail no one hand-maps); UNCLASSIFIED is reserved
# for rows that genuinely have no vendor_name to classify by at all.
# age_days mirrors pi_entries.py's days_since_payment — computed live off CURRENT_DATE, not
# stored, so it rolls over correctly on its own without a scrape run.
_CLASSIFIED_CTE = """
    WITH classified AS (
        SELECT p.*,
            CASE
                WHEN p.vendor_name IS NULL THEN 'UNCLASSIFIED'
                ELSE COALESCE(m.department::text, 'TECHNICAL')
            END AS department,
            (CURRENT_DATE - p.reg_date) AS age_days
        FROM pir_entries p
        LEFT JOIN vendor_department_mapping m
            ON m.vendor_name_normalized = p.vendor_name_normalized AND m.active = TRUE
    )
"""

# Whitelisted sort columns (frontend key -> safe SQL expression) — same convention as
# pi_entries.py's _SORTABLE_COLUMNS; never interpolate sort_by directly into SQL.
_SORTABLE_COLUMNS = {
    "invoiceNo": "invoice_no",
    "vendorName": "vendor_name",
    "vesselName": "vessel_name",
    "amount": "amount",
    "regDate": "reg_date",
    "department": "department",
    "ageDays": "age_days",
}


def _build_where_clause(search: str | None, department: str | None) -> tuple[str, dict]:
    where_clauses = []
    params: dict = {}

    if search:
        where_clauses.append(
            "(invoice_no ILIKE :search OR vendor_name ILIKE :search OR vessel_name ILIKE :search "
            "OR po_nos ILIKE :search OR vendor_invoice_no ILIKE :search)"
        )
        params["search"] = f"%{search}%"
    if department and department != "ALL":
        where_clauses.append("department = :department")
        params["department"] = department

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    return where_sql, params


def _vessel_lookup(db: Session) -> tuple[list[str], dict[uuid.UUID, str]]:
    """Shared by every endpoint that needs vessel-group resolution (see
    services/pir_vessel_matcher.py resolve_vessel_group) — one query, reused for however many
    rows are being classified in this request rather than a query per row."""
    vessels = db.query(Vessel.id, Vessel.name).all()
    return [name for (_id, name) in vessels], {vessel_id: name for (vessel_id, name) in vessels}


@router.get("", response_model=PaginatedResult[PirEntryOut])
def list_pir_entries(
    db: Session = Depends(get_db),
    _: User = Depends(require_module_access("pir")),
    search: str | None = Query(default=None),
    department: str | None = Query(default=None, description="TECHNICAL | MANNING | UNCLASSIFIED | ALL"),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    # Upper bound raised well above today's ~1900-row total (vs. the 1000 pi_entries.py uses) —
    # the PIR page groups by vessel client-side (see PIRPage.tsx), which needs the full matching
    # set in one response to sort groups by item count; there's no per-row UI pagination anymore.
    page_size: int = Query(default=50, ge=1, le=10000),
) -> dict:
    where_sql, params = _build_where_clause(search, department)

    total = db.execute(text(f"{_CLASSIFIED_CTE} SELECT count(*) FROM classified {where_sql}"), params).scalar_one()

    if sort_by and sort_by in _SORTABLE_COLUMNS:
        order_sql = f"ORDER BY {_SORTABLE_COLUMNS[sort_by]} {sort_dir.upper()} NULLS LAST, reg_date DESC"
    else:
        # Default: most recently registered problematic invoice first.
        order_sql = "ORDER BY reg_date DESC NULLS LAST, smartpal_invoice_id DESC"

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(
        text(f"{_CLASSIFIED_CTE} SELECT * FROM classified {where_sql} {order_sql} LIMIT :limit OFFSET :offset"),
        params,
    ).mappings().all()

    # Vessel-name matching (see services/pir_vessel_matcher.py) happens here in Python, not in
    # the SQL above — the substring/ambiguity logic it needs isn't a good fit for a SQL CTE, and
    # this batch is small (page_size tops out at 10000, today's whole table is ~1900 rows).
    db_vessel_names, vessel_id_to_name = _vessel_lookup(db)
    items = []
    for row in rows:
        item = dict(row)
        item["vessel_group"] = resolve_vessel_group(
            item["vessel_name"], item["assigned_vessel_id"], vessel_id_to_name, db_vessel_names
        )
        items.append(item)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/department-counts", response_model=PirDepartmentCounts)
def get_pir_department_counts(db: Session = Depends(get_db), _: User = Depends(require_module_access("pir"))) -> dict:
    """Drives the All/Technical/Manning/Unclassified tab counts — independent of the current
    list filter/pagination so the counts stay stable while paging through a filtered view."""
    rows = db.execute(text(f"{_CLASSIFIED_CTE} SELECT department, count(*) FROM classified GROUP BY department")).all()
    counts = {"technical": 0, "manning": 0, "unclassified": 0}
    for department, count in rows:
        counts[department.lower()] = count
    counts["all"] = sum(counts.values())
    return counts


@router.get("/kpis", response_model=PirKpisOut)
def get_pir_kpis(db: Session = Depends(get_db), _: User = Depends(require_module_access("pir"))) -> dict:
    """Backs the 4 KPI cards atop PIRPage — deliberately its own endpoint returning GLOBAL
    numbers (same convention as Dashboard's KpiGrid, which is independent of TrackerPage's
    filters), not scoped to whatever department tab/search the user currently has selected.

    ONE query against pir_entries (via _CLASSIFIED_CTE), then a single Python pass over that
    result set — not N+1: the vessel-group resolution this needs (to find the "needs triage"
    count and the oldest invoice's bucket) works the same way list_pir_entries's does, over
    however many rows exist today (~1900), which is cheap in one pass."""
    rows = db.execute(
        text(f"{_CLASSIFIED_CTE} SELECT id, invoice_no, vendor_name, vessel_name, assigned_vessel_id, "
             f"department, currency_code, age_days FROM classified")
    ).mappings().all()

    db_vessel_names, vessel_id_to_name = _vessel_lookup(db)

    department_counts = {"technical": 0, "manning": 0, "unclassified": 0}
    needs_triage_count = 0
    oldest: dict | None = None
    currency_counter: Counter = Counter()

    for row in rows:
        department_counts[row["department"].lower()] += 1
        vessel_group = resolve_vessel_group(
            row["vessel_name"], row["assigned_vessel_id"], vessel_id_to_name, db_vessel_names
        )
        if vessel_group in (NO_VESSEL_GROUP, UNMATCHED_VESSEL_GROUP):
            needs_triage_count += 1

        if row["age_days"] is not None and (oldest is None or row["age_days"] > oldest["age_days"]):
            oldest = {
                "id": row["id"],
                "invoice_no": row["invoice_no"],
                "vendor_name": row["vendor_name"],
                "vessel_group": vessel_group,
                "age_days": row["age_days"],
            }

        currency_counter[row["currency_code"] or "—"] += 1

    total_open = len(rows)
    department_counts["all"] = sum(department_counts.values())

    currency_mix = [
        {"currency_code": code, "count": count, "percentage": round(count / total_open * 100, 1) if total_open else 0.0}
        for code, count in currency_counter.most_common()
    ]

    return {
        "total_open": total_open,
        "by_department": department_counts,
        "needs_triage_count": needs_triage_count,
        "oldest_invoice": oldest,
        "currency_mix": currency_mix,
    }


@router.patch("/{pir_entry_id}/assign-vessel", response_model=PirEntryOut)
def assign_vessel(
    pir_entry_id: uuid.UUID,
    payload: AssignVesselRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
    __: User = Depends(require_module_access("pir")),
) -> dict:
    """Sets (or clears, if vessel_id is null) the manual vessel override — see
    PirEntry.assigned_vessel_id / pir_vessel_matcher.resolve_vessel_group. This is what the
    sidebar's "No vessel assigned" bucket's inline "Assign vessel ▾" action calls."""
    entry = db.get(PirEntry, pir_entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PIR invoice not found")

    vessel_name = None
    if payload.vessel_id is not None:
        vessel = db.get(Vessel, payload.vessel_id)
        if not vessel:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown vessel")
        vessel_name = vessel.name

    entry.assigned_vessel_id = payload.vessel_id
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.PIR_ENTRY,
        entity_id=entry.id,
        action=AuditAction.UPDATE,
        changed_by=current_user.id,
        summary=(
            f"{current_user.full_name} assigned {entry.invoice_no or entry.id} to {vessel_name}"
            if vessel_name
            else f"{current_user.full_name} cleared the vessel assignment on {entry.invoice_no or entry.id}"
        ),
    )
    db.commit()

    db_vessel_names, vessel_id_to_name = _vessel_lookup(db)
    row = db.execute(
        text(f"{_CLASSIFIED_CTE} SELECT * FROM classified WHERE id = :id"), {"id": str(pir_entry_id)}
    ).mappings().first()
    item = dict(row)
    item["vessel_group"] = resolve_vessel_group(
        item["vessel_name"], item["assigned_vessel_id"], vessel_id_to_name, db_vessel_names
    )
    return item
