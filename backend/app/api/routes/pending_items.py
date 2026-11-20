import os
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
import openpyxl
from openpyxl import Workbook
from openpyxl.drawing.image import Image as OpenpyxlImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.hyperlink import Hyperlink
from PIL import Image as PILImage, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from app.api.deps import require_module_access
from app.db.session import get_db
from app.models.po_entry import PoEntry
from app.models.pr_entry import PrEntry
from app.models.smartpal_invoice_entry import SmartpalInvoiceEntry
from app.models.pending_weekly_snapshot import PendingWeeklySnapshot
from app.models.user import User
from app.services.pi_reminder_mailer import send_mail
from app.schemas.common import PaginatedResult
from app.schemas.pending_items import (
    PendingDashboardOwnerGroup,
    PendingDashboardSummaryResponse,
    PendingDashboardTotals,
    PendingDashboardVesselRow,
    PendingItemOut,
    PendingItemsCountEntry,
    PendingItemsFilterOptions,
    PendingOwnerBreakdown,
    PendingStageBreakdown,
    PendingVesselCount,
    PreviewPendingSummaryEmailResponse,
    SendPendingSummaryEmailRequest,
    SendPendingSummaryEmailResponse,
    VesselPrReviewEmailRequest,
    PreviewVesselPrReviewEmailResponse,
    SendVesselPrReviewEmailResponse,
)

_STAGES = ("Requisition", "Purchase Order", "Invoice")
_OWNER_ROLES = ("TSI", "TA")

router = APIRouter(
    prefix="/pending-items",
    tags=["pending-items"],
    dependencies=[Depends(require_module_access("pending_items"))],
)

# Vessel -> (TSI, TA) assignment, provided by the user 2026-11-15. No DB table for this yet — it's
# a short, infrequently-changed list, so it lives here as code rather than behind an admin screen.
# A vessel not in this mapping contributes no rows to this report at all.
_VESSEL_OWNERS: dict[str, tuple[str, str]] = {
    "AMNSI MAXIMUS": ("Murtuza", "Sunil"),
    "AMNSI STALLION": ("Murtuza", "Sunil"),
    "GCL GANGA": ("Gaurav", "Jayasri"),
    "GCL TAPI": ("Murtuza", "Bharath"),
    "AM UMANG": ("Abhisek", "Gayathri"),
    "AMNS TUFMAX": ("Abhinav", "Viswa"),
    "AMNS POLAR": ("Abhinav", "Viswa"),
    "GCL SARASWATI": ("Abhinav", "Bharath"),
    "GCL FOS": ("Gaurav", "Bharath"),
    "GCL SABARMATI": ("Pavan", "Bharath"),
    "GCL YAMUNA": ("Gaurav", "Jayasri"),
    "GCL NARMADA": ("Pavan", "Viswa"),
    "AM KIRTI": ("Pavan", "Gayathri"),
    "AM TARANG": ("Pavan", "Sunil"),
}

# "Finally Approved" is a terminal state — fully done, not pending for anyone — confirmed with
# the user 2026-11-15 it must NOT be lumped in with plain "Approved" (which still has an open
# TSI/TA action against it). So it's deliberately excluded from both sets below: rows in that
# status are dropped entirely from this report across all three stages.
_PENDING_STATUSES = {"Pending"}
_APPROVED_STATUSES = {"Approved"}


def _owner(vessel_name: str | None, pending_side_role: str) -> tuple[str, str | None]:
    """pending_side_role is the role ('TSI' or 'TA') that owns the item while it's on the
    "pending" side of a stage; the other role owns it once that stage is approved. Returns
    (owner_role, owner_name) — owner_name is None for a vessel outside _VESSEL_OWNERS."""
    tsi, ta = _VESSEL_OWNERS.get((vessel_name or "").strip().upper(), (None, None))
    if pending_side_role == "TSI":
        return "TSI", tsi
    return "TA", ta


def _ageing(reference_date: date | None) -> int | None:
    if not reference_date:
        return None
    return (date.today() - reference_date).days


def _compute_pending_items(db: Session) -> list[PendingItemOut]:
    items: list[PendingItemOut] = []

    # Requisition: Pending -> TSI's job (ageing since created); Approved -> TA's job (ageing
    # since it was approved, i.e. since it became TA's job). Finally Approved is excluded
    # entirely — see _APPROVED_STATUSES.
    prs = (
        db.query(PrEntry)
        .filter(PrEntry.approval_flag.in_(_PENDING_STATUSES | _APPROVED_STATUSES))
        .all()
    )
    for pr in prs:
        is_pending = pr.approval_flag in _PENDING_STATUSES
        owner_role, owner_name = _owner(pr.vessel_name, "TSI" if is_pending else "TA")
        if owner_name is None:
            continue
        reference_date = pr.created_date if is_pending else (pr.approved_date or pr.created_date)
        items.append(
            PendingItemOut(
                stage="Requisition",
                reference_no=pr.requisition_no,
                title=pr.title,
                vessel_name=pr.vessel_name.strip().upper() if pr.vessel_name else None,
                vendor=None,
                status=pr.approval_flag,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=pr.pending_since if is_pending and pr.pending_since is not None else _ageing(reference_date),
                reference_date=reference_date,
                priority=pr.priority,
                critical=pr.critical,
                department=pr.department,
                req_category=pr.req_category,
            )
        )

    # Purchase Order: Pending -> TA's job; Approved -> TSI's job. Finally Approved excluded.
    pos = (
        db.query(PoEntry)
        .filter(PoEntry.approved_status.in_(_PENDING_STATUSES | _APPROVED_STATUSES))
        .all()
    )
    for po in pos:
        is_pending = po.approved_status in _PENDING_STATUSES
        owner_role, owner_name = _owner(po.vessel_name, "TA" if is_pending else "TSI")
        if owner_name is None:
            continue
        reference_date = po.created_date if is_pending else (po.approved_date or po.created_date)
        items.append(
            PendingItemOut(
                stage="Purchase Order",
                reference_no=po.po_no,
                title=po.title,
                vessel_name=po.vessel_name.strip().upper() if po.vessel_name else None,
                vendor=po.vendor,
                status=po.approved_status,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=po.pending_days if is_pending and po.pending_days is not None else _ageing(reference_date),
                reference_date=reference_date,
                priority=po.priority,
                critical=po.critical,
                department=None,
                req_category=po.req_category,
            )
        )

    # Invoice: Pending (Approval) -> TA's job; Approved -> TSI's job. Finally Approved excluded.
    # No "approved date" column exists on this table, so both sides age from invoice_date.
    invoices = (
        db.query(SmartpalInvoiceEntry)
        .filter(
            (SmartpalInvoiceEntry.status.ilike("Pending%"))
            | (SmartpalInvoiceEntry.status.in_(_APPROVED_STATUSES))
        )
        .all()
    )
    for inv in invoices:
        is_pending = bool(inv.status) and inv.status.lower().startswith("pending")
        owner_role, owner_name = _owner(inv.vessel_name, "TA" if is_pending else "TSI")
        if owner_name is None:
            continue
        items.append(
            PendingItemOut(
                stage="Invoice",
                reference_no=inv.invoice_no or inv.vendor_invoice_no,
                title=None,
                vessel_name=inv.vessel_name.strip().upper() if inv.vessel_name else None,
                vendor=inv.vendor_name,
                status=inv.status,
                owner_role=owner_role,
                owner_name=owner_name,
                ageing_days=_ageing(inv.invoice_date),
                reference_date=inv.invoice_date,
            )
        )

    return items


def _filtered(
    items: list[PendingItemOut],
    search: str | None,
    vessel_name: list[str] | None,
    stage: list[str] | None,
    owner_role: list[str] | None,
    owner_name: list[str] | None,
    ageing_bracket: str | None = None,
) -> list[PendingItemOut]:
    s_clean = search.strip().lower() if isinstance(search, str) and search.strip() else None
    v_clean = [v.strip().upper() for v in vessel_name if v and v.strip()] if isinstance(vessel_name, list) and vessel_name else None
    st_clean = [s.strip().lower() for s in stage if s and s.strip()] if isinstance(stage, list) and stage else None
    or_clean = owner_role if isinstance(owner_role, list) and owner_role else None
    on_clean = [o.strip() for o in owner_name if o and o.strip()] if isinstance(owner_name, list) and owner_name else None

    or_filter: list[str] | None = None
    if or_clean:
        valid_roles = [r.strip().upper() for r in or_clean if r and r.strip().upper() != "ALL"]
        if valid_roles:
            or_filter = valid_roles

    def matches(item: PendingItemOut) -> bool:
        if v_clean and (item.vessel_name or "").strip().upper() not in v_clean:
            return False
        if st_clean and (item.stage or "").strip().lower() not in st_clean:
            return False
        if or_filter and (item.owner_role or "").strip().upper() not in or_filter:
            return False
        if on_clean and (item.owner_name or "").strip() not in on_clean:
            return False
        if ageing_bracket:
            age = item.ageing_days if item.ageing_days is not None else 0
            if ageing_bracket in ("90+ Days", "Above 90 Days", "> 90 Days", "90+", "90+ Days (Critical)"):
                if age <= 90:
                    return False
            elif ageing_bracket in ("30 to 90 Days", "30 - 90 Days", "30 to 90", "30-90 Days"):
                if not (30 < age <= 90):
                    return False
            elif ageing_bracket in ("Below 30 Days", "< 30 Days", "below 30", "0 - 30 Days", "<= 30 Days"):
                if age > 30:
                    return False
            elif ageing_bracket == "< 7 Days":
                if age >= 7:
                    return False
            elif ageing_bracket == "7 - 14 Days":
                if not (7 <= age <= 14):
                    return False
            elif ageing_bracket == "15 - 30 Days":
                if not (15 <= age <= 30):
                    return False
            elif ageing_bracket == "> 30 Days":
                if age <= 30:
                    return False
        if s_clean:
            haystack = " ".join(
                filter(None, [item.reference_no, item.title, item.vessel_name, item.vendor, item.status, item.owner_name])
            ).lower()
            if s_clean not in haystack:
                return False
        return True

    return [item for item in items if matches(item)]


_SORT_KEYS = {
    "stage": lambda i: i.stage or "",
    "referenceNo": lambda i: i.reference_no or "",
    "title": lambda i: (i.title or "").lower(),
    "vesselName": lambda i: i.vessel_name or "",
    "vendor": lambda i: i.vendor or "",
    "status": lambda i: i.status or "",
    "ownerRole": lambda i: i.owner_role or "",
    "ownerName": lambda i: i.owner_name or "",
    "ageingDays": lambda i: i.ageing_days if i.ageing_days is not None else -1,
    "referenceDate": lambda i: i.reference_date or date.min,
}


def _sorted(items: list[PendingItemOut], sort_by: str | None, sort_dir: str) -> list[PendingItemOut]:
    key = _SORT_KEYS.get(sort_by) if sort_by else None
    if key is None:
        return sorted(items, key=_SORT_KEYS["ageingDays"], reverse=True)
    return sorted(items, key=key, reverse=(sort_dir == "desc"))


@router.get("", response_model=PaginatedResult[PendingItemOut])
def list_pending_items(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    owner_role: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    ageing_bracket: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[PendingItemOut]:
    items = _sorted(
        _filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name, ageing_bracket),
        sort_by,
        sort_dir,
    )
    total = len(items)
    start = (page - 1) * page_size
    return PaginatedResult[PendingItemOut](items=items[start : start + page_size], total=total, page=page, page_size=page_size)


@router.get("/counts", response_model=list[PendingItemsCountEntry])
def get_pending_items_counts(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    ageing_bracket: str | None = Query(default=None),
) -> list[PendingItemsCountEntry]:
    """Row count per (stage, owner_role) combination, under the current search/vessel/owner-name
    filters but WITHOUT stage/owner_role themselves (those are what the frontend's tabs and
    sub-tabs pick) — drives the count badge on each tab/sub-tab regardless of which one is
    currently selected."""
    items = _filtered(_compute_pending_items(db), search, vessel_name, None, None, owner_name, ageing_bracket)
    counts: dict[tuple[str, str], int] = {}
    for item in items:
        key = (item.stage, item.owner_role)
        counts[key] = counts.get(key, 0) + 1
    return [
        PendingItemsCountEntry(stage=stage, owner_role=role, count=counts.get((stage, role), 0))
        for stage in _STAGES
        for role in _OWNER_ROLES
    ]


@router.get("/breakdown", response_model=PendingStageBreakdown)
def get_pending_items_breakdown(
    db: Session = Depends(get_db),
    stage: str = Query(default="Requisition"),
) -> PendingStageBreakdown:
    """Provides dashboard-style breakdown of pending items for an entire stage:
    total counts for TSI vs TA, and each individual TSI/TA owner with their vessel-wise count."""
    items = [i for i in _compute_pending_items(db) if i.stage == stage]
    tsi_total = sum(1 for i in items if i.owner_role == "TSI")
    ta_total = sum(1 for i in items if i.owner_role == "TA")

    owner_groups: dict[tuple[str, str], list[PendingItemOut]] = defaultdict(list)
    for item in items:
        if item.owner_name and item.owner_role:
            owner_groups[(item.owner_name, item.owner_role)].append(item)

    owner_breakdowns: list[PendingOwnerBreakdown] = []
    for (owner_name, owner_role), o_items in owner_groups.items():
        v_counts = Counter(i.vessel_name for i in o_items if i.vessel_name)
        vessels = [
            PendingVesselCount(vessel_name=v_name, count=count)
            for v_name, count in sorted(v_counts.items(), key=lambda x: (-x[1], x[0]))
        ]
        owner_breakdowns.append(
            PendingOwnerBreakdown(
                owner_name=owner_name,
                owner_role=owner_role,
                total_count=len(o_items),
                vessels=vessels,
            )
        )

    # TSI owners first by count desc, then TA owners by count desc
    owner_breakdowns.sort(key=lambda o: (0 if o.owner_role == "TSI" else 1, -o.total_count, o.owner_name))

    return PendingStageBreakdown(
        stage=stage,
        total=len(items),
        tsi_total=tsi_total,
        ta_total=ta_total,
        owners=owner_breakdowns,
    )


def _get_last_completed_saturday(d: date) -> date:
    """Returns the date of the most recent completed Saturday.
    Weeks run from Sunday to Saturday. The current unfinished week is excluded
    until it completes at Saturday midnight."""
    days_back = (d.weekday() + 2) % 7
    if days_back == 0:
        days_back = 7
    return d - timedelta(days=days_back)


def _eval_week_transition(current: int, previous: int) -> str:
    """Evaluates transition between two weekly pending backlog counts.
    - Reduced backlog: reduced_green
    - Unchanged backlog: neutral
    - Moderate increase (1 to 10 items): increased_amber (even if total > 25)
    - Critical increase (> 10 items increase, or total > 25 with > 10 surge): increased_red
    """
    diff = current - previous
    if diff < 0:
        return "reduced_green"
    if diff == 0:
        return "neutral"

    # Backlog increased (diff > 0):
    if diff <= 10:
        return "increased_amber"

    # diff > 10:
    # If total backlog > 25 (or surge >= 15): critical red
    if current > 25 or diff >= 15:
        return "increased_red"
    return "increased_amber"


def _evaluate_trend_points(trend_pts: list[int | None]) -> tuple[list[str], int, str]:
    statuses = ["neutral"] * 5
    for i in range(1, 5):
        if trend_pts[i] is not None and trend_pts[i - 1] is not None:
            statuses[i] = _eval_week_transition(trend_pts[i], trend_pts[i - 1])
        else:
            statuses[i] = "neutral"

    rec_indices = [idx for idx, val in enumerate(trend_pts) if val is not None]
    if len(rec_indices) >= 2:
        prev_idx = rec_indices[-2]
        curr_idx = rec_indices[-1]
        diff = trend_pts[curr_idx] - trend_pts[prev_idx]
        status = _eval_week_transition(trend_pts[curr_idx], trend_pts[prev_idx])
    else:
        diff = 0
        status = "neutral"
    return statuses, diff, status


def _compute_5_week_trends(
    db: Session,
    live_items: list[PendingItemOut] | None = None,
) -> tuple[dict[tuple[str, str], list[int | None]], list[str]]:
    """Calculates weekly pending trends based on persistent snapshots.
    Week 1 is initialized as the current live pending count baseline.
    On each subsequent completed Saturday, a new week snapshot is recorded and compared with previous.
    """
    if live_items is None:
        live_items = _compute_pending_items(db)

    curr_counts: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"req": 0, "po": 0, "inv": 0, "total": 0})
    for item in live_items:
        if item.vessel_name and item.owner_role:
            v = item.vessel_name.strip().upper()
            r = item.owner_role.strip().upper()
            if v in _VESSEL_OWNERS:
                stg = (item.stage or "").strip()
                if stg == "Requisition":
                    curr_counts[(v, r)]["req"] += 1
                elif stg == "Purchase Order":
                    curr_counts[(v, r)]["po"] += 1
                elif stg == "Invoice":
                    curr_counts[(v, r)]["inv"] += 1
                curr_counts[(v, r)]["total"] += 1

    recorded = (
        db.query(PendingWeeklySnapshot.week_index, PendingWeeklySnapshot.snapshot_date)
        .distinct()
        .order_by(PendingWeeklySnapshot.week_index)
        .all()
    )

    today = date.today()
    if not recorded:
        for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
            for role in ("TSI", "TA"):
                owner_name = tsi if role == "TSI" else ta
                c = curr_counts[(vessel, role)]
                db.add(
                    PendingWeeklySnapshot(
                        week_index=1,
                        snapshot_date=today,
                        vessel_name=vessel,
                        owner_role=role,
                        owner_name=owner_name,
                        requisition_count=c["req"],
                        po_count=c["po"],
                        invoice_count=c["inv"],
                        total_count=c["total"],
                    )
                )
        db.commit()
        recorded = [(1, today)]
    else:
        latest_week, latest_date = recorded[-1]
        days_ahead = (5 - latest_date.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        next_sat = latest_date + timedelta(days=days_ahead)
        if today >= next_sat:
            new_week = latest_week + 1
            for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
                for role in ("TSI", "TA"):
                    owner_name = tsi if role == "TSI" else ta
                    c = curr_counts[(vessel, role)]
                    db.add(
                        PendingWeeklySnapshot(
                            week_index=new_week,
                            snapshot_date=next_sat,
                            vessel_name=vessel,
                            owner_role=role,
                            owner_name=owner_name,
                            requisition_count=c["req"],
                            po_count=c["po"],
                            invoice_count=c["inv"],
                            total_count=c["total"],
                        )
                    )
            db.commit()
            recorded.append((new_week, next_sat))

    max_week = max(w for w, _ in recorded)
    if max_week <= 5:
        window_weeks = [1, 2, 3, 4, 5]
        week_labels = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]
    else:
        window_weeks = list(range(max_week - 4, max_week + 1))
        week_labels = [f"Week {w}" for w in window_weeks]

    snaps = (
        db.query(PendingWeeklySnapshot)
        .filter(PendingWeeklySnapshot.week_index.in_(window_weeks))
        .all()
    )
    snap_map: dict[tuple[str, str], dict[int, int]] = defaultdict(dict)
    for s in snaps:
        snap_map[(s.vessel_name, s.owner_role)][s.week_index] = s.total_count

    trend_map: dict[tuple[str, str], list[int | None]] = {}
    for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
        for role in ("TSI", "TA"):
            pts = []
            for w in window_weeks:
                if w in snap_map[(vessel, role)]:
                    if w == max_week:
                        pts.append(curr_counts[(vessel, role)]["total"])
                    else:
                        pts.append(snap_map[(vessel, role)][w])
                else:
                    pts.append(None)
            trend_map[(vessel, role)] = pts

    return trend_map, week_labels


def _build_dashboard_role_groups(
    role: str,
    items: list[PendingItemOut],
    trend_map: dict[tuple[str, str], list[int | None]] | None = None,
) -> tuple[list[PendingDashboardOwnerGroup], PendingDashboardTotals]:
    assigned_vessels: dict[str, set[str]] = defaultdict(set)
    for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
        v_canon = vessel.strip().upper()
        if role == "TSI":
            assigned_vessels[tsi].add(v_canon)
        else:
            assigned_vessels[ta].add(v_canon)

    counts: dict[tuple[str, str, str], int] = Counter()
    for item in items:
        if item.owner_role == role and item.owner_name and item.vessel_name:
            v_canon = item.vessel_name.strip().upper()
            counts[(item.owner_name, v_canon, item.stage)] += 1
            assigned_vessels[item.owner_name].add(v_canon)

    owner_groups: list[PendingDashboardOwnerGroup] = []
    tot_req = 0
    tot_po = 0
    tot_inv = 0

    for owner_name, vessels in sorted(assigned_vessels.items()):
        vessel_rows: list[PendingDashboardVesselRow] = []
        o_req = 0
        o_po = 0
        o_inv = 0
        for v in sorted(vessels):
            req_c = counts[(owner_name, v, "Requisition")]
            po_c = counts[(owner_name, v, "Purchase Order")]
            inv_c = counts[(owner_name, v, "Invoice")]
            row_tot = req_c + po_c + inv_c
            v_trend = list(trend_map.get((v, role), [row_tot, None, None, None, None])) if trend_map else [row_tot, None, None, None, None]
            v_statuses, v_diff, v_status = _evaluate_trend_points(v_trend)

            vessel_rows.append(
                PendingDashboardVesselRow(
                    vessel_name=v,
                    requisition_count=req_c,
                    po_count=po_c,
                    invoice_count=inv_c,
                    total_count=row_tot,
                    weekly_trend=v_trend,
                    weekly_trend_statuses=v_statuses,
                    trend_diff=v_diff,
                    trend_status=v_status,
                )
            )
            o_req += req_c
            o_po += po_c
            o_inv += inv_c

        vessel_rows.sort(key=lambda vr: (-vr.total_count, vr.vessel_name))

        # Owner group weekly trend
        o_trend = []
        for w_idx in range(5):
            w_vals = [vr.weekly_trend[w_idx] for vr in vessel_rows if vr.weekly_trend]
            if any(val is None for val in w_vals):
                o_trend.append(None)
            else:
                o_trend.append(sum(w_vals))
        o_statuses, o_diff, o_status = _evaluate_trend_points(o_trend)

        owner_groups.append(
            PendingDashboardOwnerGroup(
                owner_name=owner_name,
                owner_role=role,
                requisition_total=o_req,
                po_total=o_po,
                invoice_total=o_inv,
                total_count=o_req + o_po + o_inv,
                vessels=vessel_rows,
                weekly_trend=o_trend,
                weekly_trend_statuses=o_statuses,
                trend_diff=o_diff,
                trend_status=o_status,
            )
        )
        tot_req += o_req
        tot_po += o_po
        tot_inv += o_inv

    owner_groups.sort(key=lambda og: (-og.total_count, og.owner_name))

    # Role totals weekly trend
    role_trend = []
    for w_idx in range(5):
        w_vals = [og.weekly_trend[w_idx] for og in owner_groups if og.weekly_trend]
        if any(val is None for val in w_vals):
            role_trend.append(None)
        else:
            role_trend.append(sum(w_vals))
    role_statuses, role_diff, role_status = _evaluate_trend_points(role_trend)

    role_totals = PendingDashboardTotals(
        requisition_total=tot_req,
        po_total=tot_po,
        invoice_total=tot_inv,
        grand_total=tot_req + tot_po + tot_inv,
        weekly_trend=role_trend,
        weekly_trend_statuses=role_statuses,
        trend_diff=role_diff,
        trend_status=role_status,
    )
    return owner_groups, role_totals


@router.get("/dashboard-summary", response_model=PendingDashboardSummaryResponse)
def get_pending_items_dashboard_summary(db: Session = Depends(get_db)) -> PendingDashboardSummaryResponse:
    """Dashboard-level overview for TSI/TA Pending:
    Provides structured tables for each TSI and TA showing vessel-wise counts across Requisitions, POs, and Invoices."""
    items = _compute_pending_items(db)
    trend_map, week_labels = _compute_5_week_trends(db, items)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items, trend_map)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items, trend_map)

    fleet_trend = []
    for w_idx in range(5):
        t_val = tsi_totals.weekly_trend[w_idx] if tsi_totals.weekly_trend else None
        ta_val = ta_totals.weekly_trend[w_idx] if ta_totals.weekly_trend else None
        if t_val is None or ta_val is None:
            fleet_trend.append(None)
        else:
            fleet_trend.append(t_val + ta_val)
    fleet_statuses, fleet_diff, fleet_status = _evaluate_trend_points(fleet_trend)

    fleet_totals = PendingDashboardTotals(
        requisition_total=tsi_totals.requisition_total + ta_totals.requisition_total,
        po_total=tsi_totals.po_total + ta_totals.po_total,
        invoice_total=tsi_totals.invoice_total + ta_totals.invoice_total,
        grand_total=tsi_totals.grand_total + ta_totals.grand_total,
        weekly_trend=fleet_trend,
        weekly_trend_statuses=fleet_statuses,
        trend_diff=fleet_diff,
        trend_status=fleet_status,
    )

    return PendingDashboardSummaryResponse(
        tsi_groups=tsi_groups,
        ta_groups=ta_groups,
        tsi_totals=tsi_totals,
        ta_totals=ta_totals,
        fleet_totals=fleet_totals,
        week_labels=week_labels,
    )


def _style_range(
    ws,
    min_col: int,
    min_row: int,
    max_col: int,
    max_row: int,
    fill=None,
    font=None,
    alignment=None,
    border=None,
):
    for r in range(min_row, max_row + 1):
        for c in range(min_col, max_col + 1):
            cell = ws.cell(row=r, column=c)
            if fill is not None:
                cell.fill = fill
            if font is not None:
                cell.font = font
            if alignment is not None:
                cell.alignment = alignment
            if border is not None:
                cell.border = border


def _render_trend_cell_image(
    points: list[int],
    statuses: list[str],
    diff: int,
    status: str,
    scale: int = 2,
) -> BytesIO:
    """Renders a 2x-DPI crisp 5-circle connected timeline graphic matching the dashboard UI."""
    w = 260 * scale
    h = 30 * scale
    img = PILImage.new("RGBA", (w, h), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)

    color_map = {
        "increased_red": ("#dc2626", "#b91c1c"),
        "increased_amber": ("#d97706", "#b45309"),
        "reduced_green": ("#16a34a", "#15803d"),
        "neutral": ("#64748b", "#475569"),
    }
    pill_map = {
        "increased_red": ("#fee2e2", "#991b1b"),
        "increased_amber": ("#fef3c7", "#92400e"),
        "reduced_green": ("#dcfce7", "#166534"),
        "neutral": ("#f1f5f9", "#475569"),
    }

    xs = [int(x * scale) for x in (18, 52, 86, 120, 160)]
    y_center = int(15 * scale)

    # Connecting track line
    draw.line([(xs[0], y_center), (xs[4], y_center)], fill="#cbd5e1", width=int(2.5 * scale))

    try:
        font_sm = ImageFont.truetype("arialbd.ttf", int(9 * scale))
        font_xs = ImageFont.truetype("arialbd.ttf", int(7.5 * scale))
        font_lg = ImageFont.truetype("arialbd.ttf", int(10 * scale))
        font_lg_xs = ImageFont.truetype("arialbd.ttf", int(8.5 * scale))
        font_pill = ImageFont.truetype("arialbd.ttf", int(9 * scale))
    except Exception:
        font_sm = font_xs = font_lg = font_lg_xs = font_pill = ImageFont.load_default()

    # Circles 0..3 (Weeks 1..4)
    r_hist = int(10 * scale)
    for i in range(4):
        cx = xs[i]
        p_val = points[i] if i < len(points) else None
        if p_val is None:
            draw.ellipse([(cx - r_hist, y_center - r_hist), (cx + r_hist, y_center + r_hist)], fill="#f1f5f9", outline="#cbd5e1", width=int(1.5 * scale))
            bbox = draw.textbbox((0, 0), "-", font=font_sm)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((cx - tw / 2, y_center - th / 2 - int(1 * scale)), "-", fill="#94a3b8", font=font_sm)
        else:
            st = statuses[i] if i < len(statuses) else "neutral"
            bg_col, border_col = color_map.get(st, color_map["neutral"])
            val_str = str(p_val)
            draw.ellipse([(cx - r_hist, y_center - r_hist), (cx + r_hist, y_center + r_hist)], fill=bg_col, outline=border_col, width=int(1.5 * scale))
            f = font_xs if len(val_str) >= 3 else font_sm
            bbox = draw.textbbox((0, 0), val_str, font=f)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((cx - tw / 2, y_center - th / 2 - int(1 * scale)), val_str, fill="#ffffff", font=f)

    # Circle 4 (Week 5)
    cx5 = xs[4]
    p5 = points[4] if len(points) > 4 else None
    if p5 is None:
        draw.ellipse([(cx5 - r_hist, y_center - r_hist), (cx5 + r_hist, y_center + r_hist)], fill="#f1f5f9", outline="#cbd5e1", width=int(1.5 * scale))
        bbox5 = draw.textbbox((0, 0), "-", font=font_sm)
        tw5 = bbox5[2] - bbox5[0]
        th5 = bbox5[3] - bbox5[1]
        draw.text((cx5 - tw5 / 2, y_center - th5 / 2 - int(1 * scale)), "-", fill="#94a3b8", font=font_sm)
    else:
        r5 = int(12.5 * scale)
        st5 = statuses[4] if len(statuses) > 4 else status
        bg5, border5 = color_map.get(st5, color_map["neutral"])
        val5_str = str(p5)
        draw.ellipse([(cx5 - r5 - int(2.5 * scale), y_center - r5 - int(2.5 * scale)), (cx5 + r5 + int(2.5 * scale), y_center + r5 + int(2.5 * scale))], fill=None, outline="#0f172a", width=int(2 * scale))
        draw.ellipse([(cx5 - r5, y_center - r5), (cx5 + r5, y_center + r5)], fill=bg5, outline=border5, width=int(1.5 * scale))
        f5 = font_lg_xs if len(val5_str) >= 3 else font_lg
        bbox5 = draw.textbbox((0, 0), val5_str, font=f5)
        tw5 = bbox5[2] - bbox5[0]
        th5 = bbox5[3] - bbox5[1]
        draw.text((cx5 - tw5 / 2, y_center - th5 / 2 - int(1 * scale)), val5_str, fill="#ffffff", font=f5)

    # Difference pill badge
    has_comparison = len([p for p in points if p is not None]) >= 2
    if has_comparison:
        pill_bg, pill_fg = pill_map.get(status, pill_map["neutral"])
        pill_txt = f"+{diff}" if diff > 0 else f"{diff}"
    else:
        pill_bg, pill_fg = pill_map["neutral"]
        pill_txt = "Week 1"

    px_start = int(188 * scale)
    px_end = int(248 * scale)
    py_top = int(5 * scale)
    py_bot = int(25 * scale)
    draw.rounded_rectangle([(px_start, py_top), (px_end, py_bot)], radius=int(10 * scale), fill=pill_bg, outline=pill_fg, width=1)
    bbox_p = draw.textbbox((0, 0), pill_txt, font=font_pill)
    tpw = bbox_p[2] - bbox_p[0]
    tph = bbox_p[3] - bbox_p[1]
    draw.text((px_start + (px_end - px_start - tpw) / 2, y_center - tph / 2 - int(1 * scale)), pill_txt, fill=pill_fg, font=font_pill)

    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf


def _trend_color_codes(status: str) -> tuple[str, str]:
    """Returns (fill_bg_hex, font_fg_hex) for a given trend transition status."""
    if status == "increased_red":
        return "FEE2E2", "991B1B"
    if status == "increased_amber":
        return "FEF3C7", "92400E"
    if status == "reduced_green":
        return "DCFCE7", "166534"
    return "F1F5F9", "475569"


def _build_dashboard_summary_workbook(db: Session, role: str = "ALL") -> Workbook:
    target_role = (role or "ALL").strip().upper()
    items = _compute_pending_items(db)
    trend_map, week_labels = _compute_5_week_trends(db, items)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items, trend_map)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items, trend_map)

    workbook = Workbook()
    sheets_to_build: list[tuple[str, str, list[PendingDashboardOwnerGroup], PendingDashboardTotals, str]] = []
    if target_role == "TSI":
        sheets_to_build.append(("TSI Pending Summary", "TSI", tsi_groups, tsi_totals, "1E3A8A"))
    elif target_role == "TA":
        sheets_to_build.append(("TA Pending Summary", "TA", ta_groups, ta_totals, "581C87"))
    else:
        sheets_to_build.append(("TSI Pending Summary", "TSI", tsi_groups, tsi_totals, "1E3A8A"))
        sheets_to_build.append(("TA Pending Summary", "TA", ta_groups, ta_totals, "581C87"))

    first_sheet = True
    date_str = datetime.now().strftime("%d %b %Y")

    border_light = Side(style="thin", color="E2E8F0")
    border_card_side = Side(style="thin", color="CBD5E1")
    border_cell = Border(left=border_light, right=border_light, top=border_light, bottom=border_light)
    border_card = Border(left=border_card_side, right=border_card_side, top=border_card_side, bottom=border_card_side)
    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")

    TOTAL_COLS = 7
    img_buffers: list[BytesIO] = []

    for sheet_title, role_label, groups, totals, hdr_bg in sheets_to_build:
        if first_sheet:
            ws = workbook.active
            ws.title = sheet_title
            first_sheet = False
        else:
            ws = workbook.create_sheet(title=sheet_title)

        ws.views.sheetView[0].showGridLines = True

        # 1. Main Title Banner
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=TOTAL_COLS)
        ws.row_dimensions[1].height = 36
        banner_title = (
            "TSI (TECHNICAL SUPERINTENDENTS) PENDING & 5-WEEK TREND OVERVIEW"
            if role_label == "TSI"
            else "TA (TECHNICAL ASSISTANTS) PENDING & 5-WEEK TREND OVERVIEW"
        )
        ws.cell(row=1, column=1, value=banner_title)
        _style_range(
            ws, 1, 1, TOTAL_COLS, 1,
            fill=PatternFill("solid", fgColor=hdr_bg),
            font=Font(name="Calibri", size=14, bold=True, color="FFFFFFFF"),
            alignment=align_center,
        )

        # 2. Subtitle Banner
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=TOTAL_COLS)
        ws.row_dimensions[2].height = 20
        subtitle_text = f"Generated on {date_str}   |   5-Week Historical Trend ({week_labels[0]} to {week_labels[4]})"
        ws.cell(row=2, column=1, value=subtitle_text)
        _style_range(
            ws, 1, 2, TOTAL_COLS, 2,
            fill=PatternFill("solid", fgColor="F8FAFC"),
            font=Font(name="Calibri", size=9, italic=True, color="FF475569"),
            alignment=align_center,
        )

        ws.row_dimensions[3].height = 8

        # 3. KPI Summary Metric Cards (Row 4-5)
        ws.row_dimensions[4].height = 16
        ws.row_dimensions[5].height = 24

        trend_status_text = (
            f"+{totals.trend_diff} (Critical Increase)" if totals.trend_status == "increased_red" else
            f"+{totals.trend_diff} (Increased)" if totals.trend_status == "increased_amber" else
            f"{totals.trend_diff} (Reduced)" if totals.trend_status == "reduced_green" else
            "0 (Unchanged)"
        )

        kpis = [
            (f"TOTAL {role_label} PENDING", totals.grand_total, 1, 2, hdr_bg),
            ("REQUISITIONS", totals.requisition_total, 3, 3, "2563EB"),
            ("PURCHASE ORDERS", totals.po_total, 4, 4, "D97706"),
            ("INVOICES", totals.invoice_total, 5, 5, "059669"),
            ("5-WEEK TREND STATUS", trend_status_text, 6, 7, "0F172A"),
        ]

        for label, val, c_start, c_end, fg_color in kpis:
            if c_end > c_start:
                ws.merge_cells(start_row=4, start_column=c_start, end_row=4, end_column=c_end)
            ws.cell(row=4, column=c_start, value=label)
            _style_range(
                ws, c_start, 4, c_end, 4,
                fill=PatternFill("solid", fgColor="FFFFFF"),
                font=Font(name="Calibri", size=8.5, bold=True, color="FF64748B"),
                alignment=align_center,
                border=border_card,
            )

            if c_end > c_start:
                ws.merge_cells(start_row=5, start_column=c_start, end_row=5, end_column=c_end)
            ws.cell(row=5, column=c_start, value=val)
            _style_range(
                ws, c_start, 5, c_end, 5,
                fill=PatternFill("solid", fgColor="FFFFFF"),
                font=Font(name="Calibri", size=12, bold=True, color=f"FF{fg_color}"),
                alignment=align_center,
                border=border_card,
            )

        ws.row_dimensions[6].height = 10

        # 4. Category Grouping Header (Row 7)
        ws.row_dimensions[7].height = 20
        cat_groups = [
            ("OWNERSHIP & VESSEL", 1, 2, "1E293B"),
            ("PENDING STAGES BREAKDOWN", 3, 5, "334155"),
            ("TOTAL", 6, 6, "0F172A"),
            (f"5-WEEK TREND ({week_labels[0].upper()} TO {week_labels[4].upper()})", 7, 7, hdr_bg),
        ]
        for c_label, c_start, c_end, c_bg in cat_groups:
            if c_end > c_start:
                ws.merge_cells(start_row=7, start_column=c_start, end_row=7, end_column=c_end)
            ws.cell(row=7, column=c_start, value=c_label)
            _style_range(
                ws, c_start, 7, c_end, 7,
                fill=PatternFill("solid", fgColor=c_bg),
                font=Font(name="Calibri", size=9, bold=True, color="FFFFFFFF"),
                alignment=align_center,
            )

        # 5. Column Headers (Row 8)
        ws.row_dimensions[8].height = 24
        col_headers = [
            f"Owner ({role_label})",
            "Vessel Name",
            "Requisitions",
            "Purchase Orders",
            "Invoices",
            "Total Pending",
            f"5-Week Trend ({week_labels[0]} → {week_labels[4]})",
        ]
        for idx, h_text in enumerate(col_headers, start=1):
            cell = ws.cell(row=8, column=idx, value=h_text)
            cell.fill = PatternFill("solid", fgColor="475569")
            cell.font = Font(name="Calibri", size=9.5, bold=True, color="FFFFFFFF")
            cell.alignment = align_center

        # 6. Data Rows
        current_row = 9
        for g in groups:
            owner_start_row = current_row
            for v in g.vessels:
                ws.row_dimensions[current_row].height = 28

                d = v.trend_diff
                w_pts = v.weekly_trend if len(v.weekly_trend) == 5 else [0, None, None, None, None]
                w_sts = v.weekly_trend_statuses if len(v.weekly_trend_statuses) == 5 else ["neutral"] * 5

                # Render & add visual trend graphic
                t_img_buf = _render_trend_cell_image(w_pts, w_sts, d, v.trend_status)
                img_buffers.append(t_img_buf)
                xl_img = OpenpyxlImage(t_img_buf)
                xl_img.width = 250
                xl_img.height = 30
                ws.add_image(xl_img, f"G{current_row}")

                w_str = [str(x) if x is not None else "–" for x in w_pts]
                row_vals = [
                    g.owner_name,
                    v.vessel_name,
                    v.requisition_count,
                    v.po_count,
                    v.invoice_count,
                    v.total_count,
                    f"{w_str[0]} → {w_str[1]} → {w_str[2]} → {w_str[3]} → {w_str[4]}",
                ]

                for c_idx, val in enumerate(row_vals, start=1):
                    c = ws.cell(row=current_row, column=c_idx, value=val)
                    c.border = border_cell
                    if c_idx == 1:
                        c.alignment = align_left
                        c.font = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")
                    elif c_idx == 2:
                        c.alignment = align_left
                        c.font = Font(name="Calibri", size=9.5, color="FF1E293B")
                    elif c_idx in (3, 4, 5):
                        c.alignment = align_center
                        c.font = Font(name="Calibri", size=9.5, color="FF1E293B")
                    elif c_idx == 6:
                        c.alignment = align_center
                        c.font = Font(name="Calibri", size=9.5, bold=True, color=f"FF{hdr_bg}")
                    elif c_idx == 7:
                        c.alignment = align_center
                        c.font = Font(name="Calibri", size=9, color="FF94A3B8")

                current_row += 1

            # Merge Owner column if multiple vessels
            if len(g.vessels) > 1:
                ws.merge_cells(start_row=owner_start_row, start_column=1, end_row=current_row - 1, end_column=1)
                _style_range(ws, 1, owner_start_row, 1, current_row - 1, alignment=Alignment(horizontal="left", vertical="center"))

            # Subtotal Row
            ws.row_dimensions[current_row].height = 30
            d_o = g.trend_diff
            w_pts_o = g.weekly_trend if len(g.weekly_trend) == 5 else [0, None, None, None, None]
            w_sts_o = g.weekly_trend_statuses if len(g.weekly_trend_statuses) == 5 else ["neutral"] * 5

            # Render & add visual trend graphic for subtotal
            t_img_buf_o = _render_trend_cell_image(w_pts_o, w_sts_o, d_o, g.trend_status)
            img_buffers.append(t_img_buf_o)
            xl_img_o = OpenpyxlImage(t_img_buf_o)
            xl_img_o.width = 250
            xl_img_o.height = 30
            ws.add_image(xl_img_o, f"G{current_row}")

            w_str_o = [str(x) if x is not None else "–" for x in w_pts_o]
            sub_vals = [
                f"\u2211 {g.owner_name} Subtotal",
                f"{len(g.vessels)} Vessels Assigned",
                g.requisition_total,
                g.po_total,
                g.invoice_total,
                g.total_count,
                f"{w_str_o[0]} → {w_str_o[1]} → {w_str_o[2]} → {w_str_o[3]} → {w_str_o[4]}",
            ]
            fill_sub = PatternFill("solid", fgColor="F1F5F9")
            font_sub = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")
            for c_idx, val in enumerate(sub_vals, start=1):
                c = ws.cell(row=current_row, column=c_idx, value=val)
                c.fill = fill_sub
                c.font = font_sub
                c.border = border_cell
                c.alignment = align_left if c_idx in (1, 2) else align_center
                if c_idx == 7:
                    c.font = Font(name="Calibri", size=9, color="FF94A3B8")
            current_row += 1

        # Fleet Grand Total Row
        ws.row_dimensions[current_row].height = 32
        d_f = totals.trend_diff
        w_pts_f = totals.weekly_trend if len(totals.weekly_trend) == 5 else [0, None, None, None, None]
        w_sts_f = totals.weekly_trend_statuses if len(totals.weekly_trend_statuses) == 5 else ["neutral"] * 5

        # Render & add visual trend graphic for fleet grand total
        t_img_buf_f = _render_trend_cell_image(w_pts_f, w_sts_f, d_f, totals.trend_status)
        img_buffers.append(t_img_buf_f)
        xl_img_f = OpenpyxlImage(t_img_buf_f)
        xl_img_f.width = 250
        xl_img_f.height = 30
        ws.add_image(xl_img_f, f"G{current_row}")

        w_str_f = [str(x) if x is not None else "–" for x in w_pts_f]
        grand_vals = [
            f"FLEET {role_label} TOTAL",
            "All Vessels Assigned",
            totals.requisition_total,
            totals.po_total,
            totals.invoice_total,
            totals.grand_total,
            f"{w_str_f[0]} → {w_str_f[1]} → {w_str_f[2]} → {w_str_f[3]} → {w_str_f[4]}",
        ]
        fill_grand = PatternFill("solid", fgColor="E2E8F0")
        font_grand = Font(name="Calibri", size=10, bold=True, color=f"FF{hdr_bg}")
        border_grand = Border(
            left=border_light, right=border_light,
            top=Side(style="medium", color="0F172A"),
            bottom=Side(style="double", color="0F172A"),
        )
        for c_idx, val in enumerate(grand_vals, start=1):
            c = ws.cell(row=current_row, column=c_idx, value=val)
            c.fill = fill_grand
            c.font = font_grand
            c.border = border_grand
            c.alignment = align_left if c_idx in (1, 2) else align_center
            if c_idx == 7:
                c.font = Font(name="Calibri", size=9.5, color="FF94A3B8")

        # Column widths
        col_widths = [18, 22, 14, 16, 14, 15, 38]
        for col_idx, width in enumerate(col_widths, start=1):
            ws.column_dimensions[get_column_letter(col_idx)].width = width

    return workbook


def _make_trend_html_circles(
    weekly_trend: list[int | None],
    weekly_trend_statuses: list[str] | None,
    trend_diff: int,
    trend_status: str,
    week_labels: list[str],
) -> str:
    pts = weekly_trend if len(weekly_trend) == 5 else [0, None, None, None, None]
    sts = weekly_trend_statuses if (weekly_trend_statuses and len(weekly_trend_statuses) == 5) else ["neutral"] * 5
    d = trend_diff
    s = trend_status
    has_comparison = len([p for p in pts if p is not None]) >= 2
    if not has_comparison:
        pill_bg = "#F1F5F9"
        pill_fg = "#475569"
        arr = "Week 1"
    elif s == "increased_red":
        pill_bg = "#FEE2E2"
        pill_fg = "#991B1B"
        arr = f"+{d} &#9650;"
    elif s == "increased_amber":
        pill_bg = "#FEF3C7"
        pill_fg = "#92400E"
        arr = f"+{d} &#9650;"
    elif s == "reduced_green":
        pill_bg = "#DCFCE7"
        pill_fg = "#166534"
        arr = f"{d} &#9660;"
    else:
        pill_bg = "#F1F5F9"
        pill_fg = "#475569"
        arr = "0 &#8212;"

    def _circle_color(status: str) -> str:
        if status == "increased_red":
            return "#DC2626"
        if status == "increased_amber":
            return "#D97706"
        if status == "reduced_green":
            return "#16A34A"
        return "#64748B"

    circles = []
    circles.append('<div style="display:inline-flex;align-items:center;justify-content:center;gap:3px;font-family:sans-serif;white-space:nowrap;">')
    for i in range(4):
        lbl = week_labels[i] if i < len(week_labels) else f"Week {i+1}"
        if pts[i] is None:
            circles.append(f'<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:#F1F5F9;border:1px dashed #CBD5E1;color:#94A3B8;font-size:10px;font-weight:700;text-align:center;vertical-align:middle;" title="{lbl}: Awaiting Saturday snapshot">&mdash;</span>')
        else:
            c_bg = _circle_color(sts[i])
            circles.append(f'<span style="display:inline-block;width:20px;height:20px;line-height:20px;border-radius:50%;background:{c_bg};color:#FFFFFF;font-size:10px;font-weight:700;text-align:center;vertical-align:middle;" title="{lbl}: {pts[i]} pending">{pts[i]}</span>')
        circles.append('<span style="display:inline-block;width:8px;height:2px;background:#CBD5E1;vertical-align:middle;"></span>')

    curr_lbl = week_labels[4] if len(week_labels) > 4 else "Week 5"
    if pts[4] is None:
        circles.append(f'<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#F1F5F9;border:1px dashed #CBD5E1;color:#94A3B8;font-size:11px;font-weight:700;text-align:center;vertical-align:middle;" title="{curr_lbl}: Awaiting Saturday snapshot">&mdash;</span>')
    else:
        last_bg = _circle_color(sts[4])
        circles.append(f'<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:{last_bg};color:#FFFFFF;font-size:11px;font-weight:800;text-align:center;vertical-align:middle;box-shadow:0 0 0 2px #FFFFFF, 0 0 0 3px #0F172A;" title="{curr_lbl}: {pts[4]} pending">{pts[4]}</span>')
    circles.append(f'<span style="display:inline-block;margin-left:6px;padding:2px 6px;border-radius:9999px;background:{pill_bg};color:{pill_fg};font-size:10px;font-weight:800;vertical-align:middle;white-space:nowrap;">{arr}</span>')
    circles.append('</div>')
    return "".join(circles)


def _build_dashboard_html_summary(
    tsi_groups: list[PendingDashboardOwnerGroup],
    ta_groups: list[PendingDashboardOwnerGroup],
    tsi_totals: PendingDashboardTotals,
    ta_totals: PendingDashboardTotals,
    fleet_totals: PendingDashboardTotals,
    week_labels: list[str],
    role_label: str = "ALL",
    filename: str = "TSI_TA_Pending_Dashboard_Summary.xlsx",
    attachment_filenames: list[str] | None = None,
) -> str:
    date_str = datetime.now().strftime("%d %b %Y")
    clean_role = (role_label or "ALL").strip().upper()
    wk_start = week_labels[0] if week_labels else "W1"
    wk_end = week_labels[-1] if week_labels else "W5"

    if clean_role == "TSI":
        active_totals = tsi_totals
        banner_title = "TSI (Technical Superintendents) Pending & 5-Week Trend Overview"
        banner_bg = "linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%)"
        accent_color = "#1E3A8A"
        sections = [("TSI (Technical Superintendents) Pending Overview", "TSI", tsi_groups, tsi_totals, "#1E3A8A")]
    elif clean_role == "TA":
        active_totals = ta_totals
        banner_title = "TA (Technical Assistants) Pending & 5-Week Trend Overview"
        banner_bg = "linear-gradient(135deg, #581C87 0%, #0F172A 100%)"
        accent_color = "#581C87"
        sections = [("TA (Technical Assistants) Pending Overview", "TA", ta_groups, ta_totals, "#581C87")]
    else:
        active_totals = fleet_totals
        banner_title = "Fleet Pending Dashboard & 5-Week Trend Overview"
        banner_bg = "linear-gradient(135deg, #0F2942 0%, #0F172A 100%)"
        accent_color = "#0F4C81"
        sections = [
            ("TSI (Technical Superintendents) Pending Overview", "TSI", tsi_groups, tsi_totals, "#1E3A8A"),
            ("TA (Technical Assistants) Pending Overview", "TA", ta_groups, ta_totals, "#581C87"),
        ]

    # KPI 5: trend status
    d_act = active_totals.trend_diff
    s_act = active_totals.trend_status
    if s_act == "increased_red":
        kpi_trend_val = f"+{d_act} &#9650;"
        kpi_trend_sub = "Critical Backlog Increase"
        kpi_trend_color = "#DC2626"
    elif s_act == "increased_amber":
        kpi_trend_val = f"+{d_act} &#9650;"
        kpi_trend_sub = "Moderate Backlog Increase"
        kpi_trend_color = "#D97706"
    elif s_act == "reduced_green":
        kpi_trend_val = f"{d_act} &#9660;"
        kpi_trend_sub = "Backlog Reduced (Good)"
        kpi_trend_color = "#16A34A"
    else:
        kpi_trend_val = "0 &#8212;"
        kpi_trend_sub = "Backlog Unchanged"
        kpi_trend_color = "#64748B"

    sections_html = []
    for sec_title, sec_role, groups, totals, hdr_color in sections:
        rows_html = []
        for g in groups:
            for v_idx, v in enumerate(g.vessels):
                trend_markup = _make_trend_html_circles(v.weekly_trend, v.weekly_trend_statuses, v.trend_diff, v.trend_status, week_labels)
                owner_cell = ""
                if v_idx == 0:
                    owner_cell = f'<td rowspan="{len(g.vessels)}" style="padding:10px 12px;border:1px solid #E2E8F0;font-weight:700;color:#0F172A;vertical-align:middle;background:#FFFFFF;">{g.owner_name}<div style="font-size:11px;color:#64748B;font-weight:normal;">{len(g.vessels)} {"Vessel" if len(g.vessels) == 1 else "Vessels"}</div></td>'

                pr_val = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#EFF6FF;color:#1E40AF;font-weight:700;font-size:12px;">{v.requisition_count}</span>' if v.requisition_count > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
                po_val = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#FEF3C7;color:#92400E;font-weight:700;font-size:12px;">{v.po_count}</span>' if v.po_count > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
                inv_val = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#ECFDF5;color:#065F46;font-weight:700;font-size:12px;">{v.invoice_count}</span>' if v.invoice_count > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
                tot_val = f'<strong style="color:{hdr_color};font-size:13px;">{v.total_count}</strong>'

                rows_html.append(f"""
                <tr style="background:#FFFFFF;">
                    {owner_cell}
                    <td style="padding:8px 12px;border:1px solid #E2E8F0;font-weight:600;color:#1E293B;vertical-align:middle;">{v.vessel_name}</td>
                    <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;vertical-align:middle;">{pr_val}</td>
                    <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;vertical-align:middle;">{po_val}</td>
                    <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;vertical-align:middle;">{inv_val}</td>
                    <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;vertical-align:middle;">{tot_val}</td>
                    <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;vertical-align:middle;">{trend_markup}</td>
                </tr>
                """)

            # Owner Subtotal Row
            sub_trend_markup = _make_trend_html_circles(g.weekly_trend, g.weekly_trend_statuses, g.trend_diff, g.trend_status, week_labels)
            pr_sub = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#EFF6FF;color:#1E40AF;font-weight:800;font-size:12px;">{g.requisition_total}</span>' if g.requisition_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
            po_sub = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#FEF3C7;color:#92400E;font-weight:800;font-size:12px;">{g.po_total}</span>' if g.po_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
            inv_sub = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#ECFDF5;color:#065F46;font-weight:800;font-size:12px;">{g.invoice_total}</span>' if g.invoice_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
            rows_html.append(f"""
            <tr style="background:#F1F5F9;border-top:1px solid #CBD5E1;font-weight:700;">
                <td colspan="2" style="padding:9px 12px;border:1px solid #CBD5E1;color:#0F172A;vertical-align:middle;">
                    <span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#E2E8F0;color:#334155;font-size:10px;margin-right:6px;letter-spacing:0.5px;">&#8721; SUBTOTAL</span>
                    <strong>{g.owner_name}</strong>
                    <span style="font-size:11px;color:#64748B;font-weight:normal;margin-left:6px;">({len(g.vessels)} vessels)</span>
                </td>
                <td style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{pr_sub}</td>
                <td style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{po_sub}</td>
                <td style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{inv_sub}</td>
                <td style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;color:{hdr_color};font-size:13px;font-weight:800;">{g.total_count}</td>
                <td style="padding:9px 10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{sub_trend_markup}</td>
            </tr>
            """)

        # Fleet Grand Total Row for this section
        fleet_trend_markup = _make_trend_html_circles(totals.weekly_trend, totals.weekly_trend_statuses, totals.trend_diff, totals.trend_status, week_labels)
        pr_tot = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#EFF6FF;color:#1E40AF;font-weight:800;font-size:12px;">{totals.requisition_total}</span>' if totals.requisition_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
        po_tot = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#FEF3C7;color:#92400E;font-weight:800;font-size:12px;">{totals.po_total}</span>' if totals.po_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'
        inv_tot = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#ECFDF5;color:#065F46;font-weight:800;font-size:12px;">{totals.invoice_total}</span>' if totals.invoice_total > 0 else '<span style="color:#CBD5E1;">&mdash;</span>'

        sections_html.append(f"""
        <div style="margin-top:24px;border-radius:8px;overflow:hidden;border:1px solid #CBD5E1;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
            <div style="background:{hdr_color};padding:12px 16px;color:#FFFFFF;font-weight:700;font-size:14px;letter-spacing:0.3px;">
                {sec_title}
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;background:#FFFFFF;" cellpadding="0" cellspacing="0">
                <thead>
                    <tr style="background:#334155;color:#FFFFFF;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">
                        <th style="padding:8px 12px;text-align:left;border:1px solid #475569;">Owner ({sec_role})</th>
                        <th style="padding:8px 12px;text-align:left;border:1px solid #475569;">Vessel Name</th>
                        <th style="padding:8px 10px;text-align:center;border:1px solid #475569;width:80px;">Requisitions</th>
                        <th style="padding:8px 10px;text-align:center;border:1px solid #475569;width:80px;">POs</th>
                        <th style="padding:8px 10px;text-align:center;border:1px solid #475569;width:80px;">Invoices</th>
                        <th style="padding:8px 10px;text-align:center;border:1px solid #475569;width:80px;">Total</th>
                        <th style="padding:8px 10px;text-align:center;border:1px solid #475569;width:220px;">5-Wk Trend ({wk_start} &rarr; {wk_end})</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(rows_html)}
                </tbody>
                <tfoot>
                    <tr style="background:#E2E8F0;border-top:2px solid #0F172A;font-weight:800;">
                        <td colspan="2" style="padding:10px 12px;border:1px solid #CBD5E1;color:{hdr_color};font-size:12px;">
                            FLEET {sec_role} TOTAL (ALL VESSELS)
                        </td>
                        <td style="padding:10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{pr_tot}</td>
                        <td style="padding:10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{po_tot}</td>
                        <td style="padding:10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{inv_tot}</td>
                        <td style="padding:10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;color:{hdr_color};font-size:14px;font-weight:900;">{totals.grand_total}</td>
                        <td style="padding:10px;border:1px solid #CBD5E1;text-align:center;vertical-align:middle;">{fleet_trend_markup}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        """)

    body_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{banner_title}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E293B;">
<div style="max-width:960px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06);">

    <!-- Header Banner -->
    <div style="background:{banner_bg};padding:24px 28px;color:#FFFFFF;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.8;margin-bottom:4px;font-weight:700;">OZELLAR MARINE MANAGEMENT &bull; PI TRACKER</div>
        <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-0.2px;">{banner_title}</h1>
        <div style="margin-top:6px;font-size:12px;opacity:0.85;">Generated on {date_str} &bull; 5-Week Weekly Backlog Trend ({wk_start} to {wk_end})</div>
    </div>

    <div style="padding:24px 28px;">
        <!-- KPI Summary Cards -->
        <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:8px;" cellpadding="0" cellspacing="0">
            <tr>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;text-align:center;width:20%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Total Pending</div>
                    <div style="font-size:22px;font-weight:800;color:{accent_color};margin-top:4px;">{active_totals.grand_total}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;text-align:center;width:20%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Requisitions</div>
                    <div style="font-size:22px;font-weight:800;color:#2563EB;margin-top:4px;">{active_totals.requisition_total}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;text-align:center;width:20%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Purchase Orders</div>
                    <div style="font-size:22px;font-weight:800;color:#D97706;margin-top:4px;">{active_totals.po_total}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;text-align:center;width:20%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Invoices</div>
                    <div style="font-size:22px;font-weight:800;color:#059669;margin-top:4px;">{active_totals.invoice_total}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 14px;text-align:center;width:20%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">5-Wk Net Change</div>
                    <div style="font-size:20px;font-weight:800;color:{kpi_trend_color};margin-top:4px;">{kpi_trend_val}</div>
                    <div style="font-size:9.5px;color:#64748B;margin-top:2px;">{kpi_trend_sub}</div>
                </td>
            </tr>
        </table>

        <!-- Role Sections Tables -->
        {''.join(sections_html)}

        {f'''<!-- Attachment Box -->
        <div style="margin-top:24px;padding:16px 20px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:8px;">
            <div style="font-weight:700;color:#0F172A;font-size:13px;margin-bottom:8px;">
                Attached Spreadsheets (3 Separate Workbooks by Stage):
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;color:#334155;">
                <tr>
                    <td style="padding:5px 0;width:24px;color:#2563EB;font-weight:700;">1.</td>
                    <td style="padding:5px 0;font-weight:600;color:#0F172A;">{attachment_filenames[0]}</td>
                    <td style="padding:5px 0;color:#64748B;font-size:11px;">Requisitions Ageing Matrix & Complete Line Items</td>
                </tr>
                <tr>
                    <td style="padding:5px 0;width:24px;color:#D97706;font-weight:700;">2.</td>
                    <td style="padding:5px 0;font-weight:600;color:#0F172A;">{attachment_filenames[1]}</td>
                    <td style="padding:5px 0;color:#64748B;font-size:11px;">Purchase Orders Ageing Matrix & Complete Line Items</td>
                </tr>
                <tr>
                    <td style="padding:5px 0;width:24px;color:#059669;font-weight:700;">3.</td>
                    <td style="padding:5px 0;font-weight:600;color:#0F172A;">{attachment_filenames[2]}</td>
                    <td style="padding:5px 0;color:#64748B;font-size:11px;">Invoices Ageing Matrix & Complete Line Items</td>
                </tr>
            </table>
            <div style="font-size:11px;color:#64748B;margin-top:8px;">
                Each workbook contains 5 interactive sheets: Ageing Summary matrix, Below 30 Days, 30-90 Days, Above 90 Days, and All Details.
            </div>
        </div>''' if attachment_filenames and len(attachment_filenames) >= 3 else f'''<!-- Attachment Box -->
        <div style="margin-top:24px;padding:14px 18px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:8px;display:flex;align-items:center;">
            <div>
                <strong style="color:#0F172A;font-size:13px;">Attached Spreadsheet: {filename}</strong>
                <div style="font-size:11px;color:#64748B;margin-top:2px;">
                    Full interactive workbook with 5 sheets including Ageing Summary matrix, ageing bracket breakdowns (Below 30, 30-90, Above 90 Days), and complete item details.
                </div>
            </div>
        </div>'''}

        <!-- Footer -->
        <div style="margin-top:24px;border-top:1px solid #E2E8F0;padding-top:14px;font-size:11px;color:#64748B;line-height:1.5;">
            This executive summary was dispatched automatically by Ozellar PI Monitoring Engine.<br>
            For live updates, interactive filtering, or immediate action, please access the <strong>PI Tracker Dashboard</strong>.
        </div>
    </div>
</div>
</body>
</html>"""
    return body_html


@router.get("/dashboard-summary/export")
def export_pending_items_dashboard_summary(
    role: str = Query(default="ALL"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    target_role = (role or "ALL").strip().upper()
    if target_role not in ("ALL", "TSI", "TA"):
        target_role = "ALL"

    workbook = _build_dashboard_summary_workbook(db, target_role)

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    if target_role == "TSI":
        filename = "TSI_Pending_Dashboard_Summary.xlsx"
    elif target_role == "TA":
        filename = "TA_Pending_Dashboard_Summary.xlsx"
    else:
        filename = "Fleet_Pending_Dashboard_Summary.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/dashboard-summary/preview-email", response_model=PreviewPendingSummaryEmailResponse)
def preview_pending_items_dashboard_summary_email(
    payload: SendPendingSummaryEmailRequest,
    db: Session = Depends(get_db),
) -> PreviewPendingSummaryEmailResponse:
    target_role = (payload.role or "ALL").strip().upper()
    if target_role not in ("ALL", "TSI", "TA"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be 'ALL', 'TSI', or 'TA'.",
        )

    items = _compute_pending_items(db)
    trend_map, week_labels = _compute_5_week_trends(db, items)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items, trend_map)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items, trend_map)

    fleet_trend = []
    for w_idx in range(5):
        t_val = tsi_totals.weekly_trend[w_idx] if tsi_totals.weekly_trend else None
        ta_val = ta_totals.weekly_trend[w_idx] if ta_totals.weekly_trend else None
        if t_val is None or ta_val is None:
            fleet_trend.append(None)
        else:
            fleet_trend.append(t_val + ta_val)
    fleet_statuses, fleet_diff, fleet_status = _evaluate_trend_points(fleet_trend)

    fleet_totals = PendingDashboardTotals(
        requisition_total=tsi_totals.requisition_total + ta_totals.requisition_total,
        po_total=tsi_totals.po_total + ta_totals.po_total,
        invoice_total=tsi_totals.invoice_total + ta_totals.invoice_total,
        grand_total=tsi_totals.grand_total + ta_totals.grand_total,
        weekly_trend=fleet_trend,
        weekly_trend_statuses=fleet_statuses,
        trend_diff=fleet_diff,
        trend_status=fleet_status,
    )

    role_filter = [target_role] if target_role in ("TSI", "TA") else None
    items_for_role = items if not role_filter else [i for i in items if i.owner_role == target_role]
    role_suffix = target_role if target_role in ("TSI", "TA") else "All"

    req_filename = f"Requisition_{role_suffix}_Pending_Ageing.xlsx"
    po_filename = f"Purchase_Order_{role_suffix}_Pending_Ageing.xlsx"
    inv_filename = f"Invoice_{role_suffix}_Pending_Ageing.xlsx"
    attachment_filenames = [req_filename, po_filename, inv_filename]
    attachment_filename = f"{req_filename}, {po_filename}, {inv_filename}"
    item_count = len(items_for_role)

    html_body = _build_dashboard_html_summary(
        tsi_groups=tsi_groups,
        ta_groups=ta_groups,
        tsi_totals=tsi_totals,
        ta_totals=ta_totals,
        fleet_totals=fleet_totals,
        week_labels=week_labels,
        role_label=target_role,
        filename=attachment_filename,
        attachment_filenames=attachment_filenames,
    )

    if target_role == "TSI":
        target_users = db.query(User).filter(User.rank == "TSI", User.is_active.is_(True)).all()
    elif target_role == "TA":
        target_users = db.query(User).filter(User.rank == "TA", User.is_active.is_(True)).all()
    else:
        target_users = db.query(User).filter(User.rank.in_(["TSI", "TA"]), User.is_active.is_(True)).all()

    to_emails_set = {u.email.strip() for u in target_users if u.email and u.email.strip()}
    for m in MANDATORY_TO_EMAILS:
        to_emails_set.add(m.strip())
    default_to_emails = sorted(to_emails_set)
    default_cc_emails = list(DEFAULT_CC_EMAILS)

    date_str = datetime.now().strftime("%d %b %Y")
    if target_role == "TSI":
        default_subject = f"TSI Pending Dashboard & Weekly Trend Summary ({date_str})"
    elif target_role == "TA":
        default_subject = f"TA Pending Dashboard & Weekly Trend Summary ({date_str})"
    else:
        default_subject = f"Fleet Pending Dashboard & Weekly Trend Summary ({date_str})"

    from_mailbox = "data@ozellar.com"

    return PreviewPendingSummaryEmailResponse(
        role=target_role,
        stage=None,
        subject=default_subject,
        from_mailbox=from_mailbox,
        default_to_emails=default_to_emails,
        default_cc_emails=default_cc_emails,
        attachment_filename=attachment_filename,
        attachment_filenames=attachment_filenames,
        items_count=item_count,
        html_body=html_body,
    )


@router.post("/dashboard-summary/send-email", response_model=SendPendingSummaryEmailResponse)
def send_pending_items_dashboard_summary_email(
    payload: SendPendingSummaryEmailRequest,
    db: Session = Depends(get_db),
) -> SendPendingSummaryEmailResponse:
    target_role = (payload.role or "ALL").strip().upper()
    if target_role not in ("ALL", "TSI", "TA"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be 'ALL', 'TSI', or 'TA'.",
        )

    items = _compute_pending_items(db)
    trend_map, week_labels = _compute_5_week_trends(db, items)
    tsi_groups, tsi_totals = _build_dashboard_role_groups("TSI", items, trend_map)
    ta_groups, ta_totals = _build_dashboard_role_groups("TA", items, trend_map)

    fleet_trend = []
    for w_idx in range(5):
        t_val = tsi_totals.weekly_trend[w_idx] if tsi_totals.weekly_trend else None
        ta_val = ta_totals.weekly_trend[w_idx] if ta_totals.weekly_trend else None
        if t_val is None or ta_val is None:
            fleet_trend.append(None)
        else:
            fleet_trend.append(t_val + ta_val)
    fleet_statuses, fleet_diff, fleet_status = _evaluate_trend_points(fleet_trend)

    fleet_totals = PendingDashboardTotals(
        requisition_total=tsi_totals.requisition_total + ta_totals.requisition_total,
        po_total=tsi_totals.po_total + ta_totals.po_total,
        invoice_total=tsi_totals.invoice_total + ta_totals.invoice_total,
        grand_total=tsi_totals.grand_total + ta_totals.grand_total,
        weekly_trend=fleet_trend,
        weekly_trend_statuses=fleet_statuses,
        trend_diff=fleet_diff,
        trend_status=fleet_status,
    )

    role_filter = [target_role] if target_role in ("TSI", "TA") else None
    items_for_role = items if not role_filter else [i for i in items if i.owner_role == target_role]
    role_suffix = target_role if target_role in ("TSI", "TA") else "All"

    req_filename = f"Requisition_{role_suffix}_Pending_Ageing.xlsx"
    po_filename = f"Purchase_Order_{role_suffix}_Pending_Ageing.xlsx"
    inv_filename = f"Invoice_{role_suffix}_Pending_Ageing.xlsx"
    attachment_filenames = [req_filename, po_filename, inv_filename]
    attachment_filename = f"{req_filename}, {po_filename}, {inv_filename}"
    item_count = len(items_for_role)

    req_items = [i for i in items_for_role if (i.stage or "").strip().lower() == "requisition"]
    po_items = [i for i in items_for_role if (i.stage or "").strip().lower() == "purchase order"]
    inv_items = [i for i in items_for_role if (i.stage or "").strip().lower() == "invoice"]

    attachments_payload: list[dict] = []
    for stg_label, fname, stg_items in [
        ("Requisition", req_filename, req_items),
        ("Purchase Order", po_filename, po_items),
        ("Invoice", inv_filename, inv_items),
    ]:
        wb = _build_pending_items_ageing_workbook(
            items=stg_items,
            stage_filter=[stg_label],
            role_filter=role_filter,
        )
        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        attachments_payload.append(
            {
                "name": fname,
                "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "contentBytes": buf.getvalue(),
            }
        )

    html_body = _build_dashboard_html_summary(
        tsi_groups=tsi_groups,
        ta_groups=ta_groups,
        tsi_totals=tsi_totals,
        ta_totals=ta_totals,
        fleet_totals=fleet_totals,
        week_labels=week_labels,
        role_label=target_role,
        filename=attachment_filename,
        attachment_filenames=attachment_filenames,
    )

    if payload.test_email and payload.test_email.strip():
        recipients = [payload.test_email.strip()]
        cc_recipients = []
    elif payload.to_emails is not None and len(payload.to_emails) > 0:
        recipients = sorted({e.strip() for e in payload.to_emails if e and e.strip()})
        cc_source = payload.cc_emails if payload.cc_emails is not None else []
        cc_recipients = sorted({e.strip() for e in cc_source if e and e.strip()})
    else:
        if target_role == "TSI":
            target_users = db.query(User).filter(User.rank == "TSI", User.is_active.is_(True)).all()
        elif target_role == "TA":
            target_users = db.query(User).filter(User.rank == "TA", User.is_active.is_(True)).all()
        else:
            target_users = db.query(User).filter(User.rank.in_(["TSI", "TA"]), User.is_active.is_(True)).all()
        to_set = {u.email.strip() for u in target_users if u.email and u.email.strip()}
        for m in MANDATORY_TO_EMAILS:
            to_set.add(m.strip())
        recipients = sorted(to_set)
        cc_source = payload.cc_emails if payload.cc_emails is not None else DEFAULT_CC_EMAILS
        cc_recipients = sorted({e.strip() for e in cc_source if e and e.strip()})

    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active recipient emails provided or found for '{target_role}'.",
        )

    date_str = datetime.now().strftime("%d %b %Y")
    if payload.subject and payload.subject.strip():
        subject = payload.subject.strip()
    elif target_role == "TSI":
        subject = f"TSI Pending Dashboard & Weekly Trend Summary ({date_str})"
    elif target_role == "TA":
        subject = f"TA Pending Dashboard & Weekly Trend Summary ({date_str})"
    else:
        subject = f"Fleet Pending Dashboard & Weekly Trend Summary ({date_str})"

    from_mailbox = "data@ozellar.com"

    try:
        send_mail(
            to_emails=recipients,
            subject=subject,
            html_body=html_body,
            from_mailbox=from_mailbox,
            cc_emails=cc_recipients,
            attachments=attachments_payload,
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send dashboard summary email: {e}",
        ) from e

    return SendPendingSummaryEmailResponse(
        sent=True,
        role=target_role,
        stage=None,
        recipients=recipients,
        cc_recipients=cc_recipients,
        subject=subject,
        from_mailbox=from_mailbox,
        attachment_filename=attachment_filename,
        attachment_filenames=attachment_filenames,
        items_count=item_count,
    )


@router.post("/dashboard-summary/record-snapshot")
def record_dashboard_weekly_snapshot(
    db: Session = Depends(get_db),
    force_week: int | None = Query(default=None),
) -> dict:
    """Manually records a snapshot for the current live backlog, advancing the snapshot week.
    Useful for testing or scheduled cron job triggers."""
    items = _compute_pending_items(db)
    curr_counts: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: {"req": 0, "po": 0, "inv": 0, "total": 0})
    for item in items:
        if item.vessel_name and item.owner_role:
            v = item.vessel_name.strip().upper()
            r = item.owner_role.strip().upper()
            if v in _VESSEL_OWNERS:
                stg = (item.stage or "").strip()
                if stg == "Requisition":
                    curr_counts[(v, r)]["req"] += 1
                elif stg == "Purchase Order":
                    curr_counts[(v, r)]["po"] += 1
                elif stg == "Invoice":
                    curr_counts[(v, r)]["inv"] += 1
                curr_counts[(v, r)]["total"] += 1

    recorded = (
        db.query(PendingWeeklySnapshot.week_index, PendingWeeklySnapshot.snapshot_date)
        .distinct()
        .order_by(PendingWeeklySnapshot.week_index)
        .all()
    )
    max_week = max([w for w, _ in recorded], default=0)
    next_week = force_week if force_week is not None else (max_week + 1)
    today = date.today()

    for vessel, (tsi, ta) in _VESSEL_OWNERS.items():
        for role in ("TSI", "TA"):
            owner_name = tsi if role == "TSI" else ta
            c = curr_counts[(vessel, role)]
            db.add(
                PendingWeeklySnapshot(
                    week_index=next_week,
                    snapshot_date=today,
                    vessel_name=vessel,
                    owner_role=role,
                    owner_name=owner_name,
                    requisition_count=c["req"],
                    po_count=c["po"],
                    invoice_count=c["inv"],
                    total_count=c["total"],
                )
            )
    db.commit()
    return {"status": "success", "recorded_week": next_week, "date": str(today)}


def _build_vessel_pr_review_html(
    vessel_name: str,
    pr_type: str,
    items: list[PendingItemOut],
    tsi_name: str | None,
    ta_name: str | None,
    filename: str,
) -> str:
    date_str = datetime.now().strftime("%d %b %Y")
    max_days = max([i.ageing_days or 0 for i in items], default=0)

    if pr_type == "ageing_90":
        type_title = "OVERDUE REQUISITIONS (90+ DAYS PENDING)"
    elif pr_type == "critical":
        type_title = "CRITICAL & HIGH PRIORITY REQUISITIONS"
    else:
        type_title = "OUTSTANDING REQUISITIONS REVIEW"

    rows_html = []
    for idx, item in enumerate(items, start=1):
        age = item.ageing_days or 0
        if age > 90:
            age_badge = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#FCE7F3;color:#831843;font-weight:700;font-size:11px;">{age} Days</span>'
        elif age > 30:
            age_badge = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#FEF3C7;color:#92400E;font-weight:700;font-size:11px;">{age} Days</span>'
        else:
            age_badge = f'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:#EFF6FF;color:#1E40AF;font-weight:700;font-size:11px;">{age} Days</span>'

        prio_str = (item.priority or "NORMAL").upper()
        if item.critical:
            prio_badge = '<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#DC2626;color:#FFFFFF;font-weight:800;font-size:10px;">CRITICAL</span>'
        elif prio_str in ("URGENT/IMMEDIATE", "HIGH"):
            prio_badge = f'<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#F97316;color:#FFFFFF;font-weight:700;font-size:10px;">{prio_str}</span>'
        else:
            prio_badge = f'<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#E2E8F0;color:#475569;font-weight:600;font-size:10px;">{prio_str}</span>'

        date_formatted = item.reference_date.strftime("%d-%b-%Y") if item.reference_date else "—"
        dept = item.department or item.req_category or "Technical"
        title = item.title or "Requisition Items"
        st = item.status or "Pending"
        role_cls = "#1E40AF" if item.owner_role == "TSI" else "#047857"

        rows_html.append(f"""
        <tr style="background:{'#FFFFFF' if idx % 2 != 0 else '#F8FAFC'};">
            <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;font-size:11px;color:#64748B;">{idx}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;font-weight:700;color:#0F172A;font-size:11.5px;white-space:nowrap;">{item.reference_no}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:11px;color:#334155;white-space:nowrap;">{date_formatted}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:11px;color:#475569;font-weight:600;">{dept}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;font-size:11.5px;color:#1E293B;">{title}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;">{prio_badge}</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;font-size:11px;font-weight:700;color:{role_cls};">{st} ({item.owner_role})</td>
            <td style="padding:8px 10px;border:1px solid #E2E8F0;text-align:center;">{age_badge}</td>
        </tr>
        """)

    body_html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Technical Requisition Review - M/V {vessel_name}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1E293B;">
<div style="max-width:960px;margin:0 auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06);">

    <!-- Header Banner -->
    <div style="background:linear-gradient(135deg, #0F2942 0%, #1E3A8A 100%);padding:24px 28px;color:#FFFFFF;">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:0.85;margin-bottom:4px;font-weight:700;">
            OZELLAR MARINE MANAGEMENT &bull; TECHNICAL FLEET PROCUREMENT
        </div>
        <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-0.2px;">
            TECHNICAL REVIEW: {type_title} &bull; M/V {vessel_name}
        </h1>
        <div style="margin-top:6px;font-size:12px;opacity:0.9;">
            Generated on {date_str} &bull; Official Superintendent Operational Disposition Notice
        </div>
    </div>

    <div style="padding:24px 28px;">
        <!-- Vessel & In-Charge Quick Glance -->
        <table style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:16px;" cellpadding="0" cellspacing="0">
            <tr>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;width:25%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;">Target Vessel</div>
                    <div style="font-size:15px;font-weight:800;color:#0F172A;margin-top:2px;">M/V {vessel_name}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;width:25%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;">Assigned TSI</div>
                    <div style="font-size:14px;font-weight:700;color:#1E3A8A;margin-top:2px;">{tsi_name or 'Unassigned'}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;width:25%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;">Assigned TA</div>
                    <div style="font-size:14px;font-weight:700;color:#581C87;margin-top:2px;">{ta_name or 'Unassigned'}</div>
                </td>
                <td style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px 14px;width:25%;">
                    <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;">Pending Scope</div>
                    <div style="font-size:15px;font-weight:800;color:#DC2626;margin-top:2px;">{len(items)} Requisition(s) (Max {max_days}d)</div>
                </td>
            </tr>
        </table>

        <!-- Formal Salutation & Operational Context -->
        <div style="font-size:13px;line-height:1.6;color:#334155;margin-bottom:18px;">
            <p style="margin:0 0 10px 0;"><strong>Dear Technical Superintendent &amp; Technical Assistant,</strong></p>
            <p style="margin:0 0 10px 0;">
                During our regular fleet technical procurement audit, the following purchase requisition(s) for <strong>M/V {vessel_name}</strong> have remained pending for an extended duration (up to <strong>{max_days} days</strong>).
            </p>
            <p style="margin:0;">
                Prolonged pending requisitions impact procurement forecasting, lead-time planning, and inventory tracking. Please technically assess the items listed below and communicate your operational requirement.
            </p>
        </div>

        <!-- PR Data Table -->
        <div style="margin-bottom:20px;overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;border:1px solid #CBD5E1;font-size:11.5px;" cellpadding="0" cellspacing="0">
                <thead>
                    <tr style="background:#1E293B;color:#FFFFFF;">
                        <th style="padding:9px 10px;text-align:center;width:5%;">#</th>
                        <th style="padding:9px 10px;text-align:left;width:18%;">Requisition No.</th>
                        <th style="padding:9px 10px;text-align:left;width:11%;">Created Date</th>
                        <th style="padding:9px 10px;text-align:left;width:12%;">Department</th>
                        <th style="padding:9px 10px;text-align:left;width:28%;">Description / Equipment</th>
                        <th style="padding:9px 10px;text-align:center;width:9%;">Priority</th>
                        <th style="padding:9px 10px;text-align:center;width:9%;">Status</th>
                        <th style="padding:9px 10px;text-align:center;width:8%;">Ageing</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(rows_html)}
                </tbody>
            </table>
        </div>

        <!-- Technical Action Protocol Card (Hold / Cancel / Proceed) -->
        <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-left:4px solid #1E3A8A;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
            <div style="font-size:13px;font-weight:800;color:#0F172A;margin-bottom:8px;">
                ACTION REQUIRED: TECHNICAL DISPOSITION GUIDELINES
            </div>
            <div style="font-size:12px;line-height:1.6;color:#334155;">
                Please reply to this communication advising one of the following technical courses of action for each item:
                <ul style="margin:8px 0 0 0;padding-left:18px;">
                    <li style="margin-bottom:6px;">
                        <strong>1. PROCEED / APPROVE:</strong> If these spares, consumables, or services are still operationally critical for vessel class/safety or upcoming port calls, please complete approval and confirm target supply port/ETA.
                    </li>
                    <li style="margin-bottom:6px;">
                        <strong>2. HOLD:</strong> If the requisition must be held temporarily (e.g. awaiting dry-docking confirmation, further onboard inspection, or quote clarifications), please provide the specific <em>HOLD Reason</em> and tentative review date.
                    </li>
                    <li>
                        <strong>3. CANCEL:</strong> If the requirement is no longer valid, has been fulfilled through existing shipboard inventory, or was transferred from sister vessels, please cancel the requisition in SmartPAL to relieve active procurement backlog.
                    </li>
                </ul>
            </div>
        </div>

        <!-- Attachment Box -->
        <div style="padding:12px 16px;background:#F1F5F9;border:1px dashed #CBD5E1;border-radius:6px;margin-bottom:20px;">
            <strong style="color:#0F172A;font-size:12px;">Attached Itemized Report: {filename}</strong>
            <div style="font-size:11px;color:#64748B;margin-top:2px;">
                Spreadsheet containing full requisition details, part numbers, and status for convenient offline review.
            </div>
        </div>

        <!-- Footer -->
        <div style="border-top:1px solid #E2E8F0;padding-top:14px;font-size:11px;color:#64748B;line-height:1.5;">
            This technical inquiry was dispatched automatically by Ozellar Marine Management PI Monitoring Engine.<br>
            For live updates or immediate action, access the <strong>PI Tracker System</strong>.
        </div>
    </div>
</div>
</body>
</html>"""
    return body_html


def _build_vessel_pr_workbook(
    vessel_name: str,
    pr_type: str,
    items: list[PendingItemOut],
) -> Workbook:
    wb = Workbook()
    ws = wb.active
    ws.title = "Requisition Review"
    ws.views.sheetView[0].showGridLines = True

    # Title Banner
    ws.merge_cells("A1:H1")
    ws.row_dimensions[1].height = 32
    c1 = ws["A1"]
    c1.value = f"OZELLAR MARINE MANAGEMENT • M/V {vessel_name.upper()} REQUISITIONS TECHNICAL REVIEW"
    c1.fill = PatternFill("solid", fgColor="0F2942")
    c1.font = Font(name="Calibri", size=11, bold=True, color="FFFFFFFF")
    c1.alignment = Alignment(horizontal="center", vertical="center")

    # Subtitle
    ws.merge_cells("A2:H2")
    ws.row_dimensions[2].height = 20
    c2 = ws["A2"]
    c2.value = f"Generated on {datetime.now().strftime('%d-%b-%Y %H:%M')} | Total Scope: {len(items)} Requisitions | Max Ageing: {max([i.ageing_days or 0 for i in items], default=0)} Days"
    c2.fill = PatternFill("solid", fgColor="F1F5F9")
    c2.font = Font(name="Calibri", size=9.5, italic=True, color="FF475569")
    c2.alignment = Alignment(horizontal="center", vertical="center")

    ws.row_dimensions[3].height = 8

    # Headers
    headers = [
        ("Sl No.", 8, Alignment(horizontal="center", vertical="center")),
        ("Requisition No.", 22, Alignment(horizontal="center", vertical="center")),
        ("Created Date", 15, Alignment(horizontal="center", vertical="center")),
        ("Department", 16, Alignment(horizontal="left", vertical="center")),
        ("Description / Equipment", 42, Alignment(horizontal="left", vertical="center", wrap_text=True)),
        ("Priority", 14, Alignment(horizontal="center", vertical="center")),
        ("Status & In-Charge", 18, Alignment(horizontal="center", vertical="center")),
        ("Ageing (Days)", 14, Alignment(horizontal="center", vertical="center")),
    ]

    ws.row_dimensions[4].height = 24
    for col_idx, (h_title, width, align) in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=col_idx, value=h_title)
        cell.fill = PatternFill("solid", fgColor="1E293B")
        cell.font = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        col_letter = get_column_letter(col_idx)
        ws.column_dimensions[col_letter].width = width

    border_thin = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    for row_idx, item in enumerate(items, start=5):
        ws.row_dimensions[row_idx].height = 24
        is_even = (row_idx % 2 == 0)
        row_fill = PatternFill("solid", fgColor="F8FAFC" if is_even else "FFFFFF")

        vals = [
            row_idx - 4,
            item.reference_no,
            item.reference_date.strftime("%d-%b-%Y") if item.reference_date else "—",
            item.department or item.req_category or "Technical",
            item.title or "Requisition Items",
            ("CRITICAL" if item.critical else (item.priority or "NORMAL")).upper(),
            f"{item.status or 'Pending'} ({item.owner_role})",
            item.ageing_days or 0,
        ]

        for col_idx, val in enumerate(vals, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=val)
            cell.fill = row_fill
            cell.border = border_thin
            cell.alignment = headers[col_idx - 1][2]
            cell.font = Font(name="Calibri", size=9.5, color="FF0F172A")
            if col_idx == 8 and isinstance(val, int) and val > 90:
                cell.font = Font(name="Calibri", size=9.5, bold=True, color="FF991B1B")

    return wb


@router.post("/vessel-pr-review/preview-email", response_model=PreviewVesselPrReviewEmailResponse)
def preview_vessel_pr_review_email(
    payload: VesselPrReviewEmailRequest,
    db: Session = Depends(get_db),
) -> PreviewVesselPrReviewEmailResponse:
    target_vessel = payload.vessel_name.strip().upper()
    pr_type = (payload.pr_type or "ageing_90").strip().lower()
    role_filter = payload.role.strip().upper() if payload.role and payload.role.strip().upper() in ("TSI", "TA") else None

    all_items = [i for i in _compute_pending_items(db) if i.stage == "Requisition"]
    vessel_items = [i for i in all_items if (i.vessel_name or "").strip().upper() == target_vessel]
    if role_filter:
        vessel_items = [i for i in vessel_items if i.owner_role == role_filter]

    if pr_type == "ageing_90":
        filtered_items = [i for i in vessel_items if (i.ageing_days or 0) > 90]
    elif pr_type == "critical":
        filtered_items = [
            i for i in vessel_items
            if i.critical is True or (i.priority or "").upper() in ("URGENT/IMMEDIATE", "HIGH", "DEFECT CORRECTION")
        ]
    else:
        filtered_items = vessel_items

    filtered_items.sort(key=lambda x: (-(x.ageing_days or 0), x.reference_no or ""))

    tsi_name, ta_name = _VESSEL_OWNERS.get(target_vessel, (None, None))
    tsi_user = db.query(User).filter(User.full_name.ilike(f"%{tsi_name}%")).first() if tsi_name else None
    ta_user = db.query(User).filter(User.full_name.ilike(f"%{ta_name}%")).first() if ta_name else None

    to_emails = []
    if tsi_user and tsi_user.email:
        to_emails.append(tsi_user.email.strip())
    if ta_user and ta_user.email:
        to_emails.append(ta_user.email.strip())
    if not to_emails:
        if tsi_name:
            t = db.query(User).filter(User.rank == "TSI", User.is_active.is_(True)).first()
            if t and t.email:
                to_emails.append(t.email.strip())

    default_cc = ["kunalchandra@ozellar.com", "Karunya.pius@ozellar.com", "data@ozellar.com"]

    clean_v_name = target_vessel.replace(" ", "_")
    if pr_type == "ageing_90":
        default_subject = f"Technical Review: Overdue Requisitions (90+ Days) – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Overdue_PR_Review.xlsx"
    elif pr_type == "critical":
        default_subject = f"Technical Review: Critical Requisitions Pending Action – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Critical_PR_Review.xlsx"
    else:
        default_subject = f"Technical Review: Pending Requisitions – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Requisitions_Review.xlsx"

    html_body = _build_vessel_pr_review_html(
        vessel_name=target_vessel,
        pr_type=pr_type,
        items=filtered_items,
        tsi_name=tsi_name,
        ta_name=ta_name,
        filename=att_filename,
    )

    return PreviewVesselPrReviewEmailResponse(
        vessel_name=target_vessel,
        pr_type=pr_type,
        subject=default_subject,
        from_mailbox="data@ozellar.com",
        default_to_emails=sorted(set(to_emails)),
        default_cc_emails=default_cc,
        items_count=len(filtered_items),
        items=filtered_items,
        html_body=html_body,
        attachment_filename=att_filename,
    )


@router.post("/vessel-pr-review/send-email", response_model=SendVesselPrReviewEmailResponse)
def send_vessel_pr_review_email(
    payload: VesselPrReviewEmailRequest,
    db: Session = Depends(get_db),
) -> SendVesselPrReviewEmailResponse:
    target_vessel = payload.vessel_name.strip().upper()
    pr_type = (payload.pr_type or "ageing_90").strip().lower()
    role_filter = payload.role.strip().upper() if payload.role and payload.role.strip().upper() in ("TSI", "TA") else None

    all_items = [i for i in _compute_pending_items(db) if i.stage == "Requisition"]
    vessel_items = [i for i in all_items if (i.vessel_name or "").strip().upper() == target_vessel]
    if role_filter:
        vessel_items = [i for i in vessel_items if i.owner_role == role_filter]

    if pr_type == "ageing_90":
        filtered_items = [i for i in vessel_items if (i.ageing_days or 0) > 90]
    elif pr_type == "critical":
        filtered_items = [
            i for i in vessel_items
            if i.critical is True or (i.priority or "").upper() in ("URGENT/IMMEDIATE", "HIGH", "DEFECT CORRECTION")
        ]
    else:
        filtered_items = vessel_items

    filtered_items.sort(key=lambda x: (-(x.ageing_days or 0), x.reference_no or ""))

    tsi_name, ta_name = _VESSEL_OWNERS.get(target_vessel, (None, None))
    clean_v_name = target_vessel.replace(" ", "_")
    if pr_type == "ageing_90":
        default_subject = f"Technical Review: Overdue Requisitions (90+ Days) – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Overdue_PR_Review.xlsx"
    elif pr_type == "critical":
        default_subject = f"Technical Review: Critical Requisitions Pending Action – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Critical_PR_Review.xlsx"
    else:
        default_subject = f"Technical Review: Pending Requisitions – M/V {target_vessel}"
        att_filename = f"M_V_{clean_v_name}_Requisitions_Review.xlsx"

    subject = payload.subject.strip() if payload.subject and payload.subject.strip() else default_subject

    # Recipients
    if payload.test_email and payload.test_email.strip():
        recipients = [payload.test_email.strip()]
        cc_recipients = []
    elif payload.to_emails and len(payload.to_emails) > 0:
        recipients = sorted({e.strip() for e in payload.to_emails if e and e.strip()})
        cc_source = payload.cc_emails if payload.cc_emails is not None else []
        cc_recipients = sorted({e.strip() for e in cc_source if e and e.strip()})
    else:
        tsi_user = db.query(User).filter(User.full_name.ilike(f"%{tsi_name}%")).first() if tsi_name else None
        ta_user = db.query(User).filter(User.full_name.ilike(f"%{ta_name}%")).first() if ta_name else None
        to_set = set()
        if tsi_user and tsi_user.email:
            to_set.add(tsi_user.email.strip())
        if ta_user and ta_user.email:
            to_set.add(ta_user.email.strip())
        recipients = sorted(to_set)
        cc_recipients = ["kunalchandra@ozellar.com", "Karunya.pius@ozellar.com", "data@ozellar.com"]

    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No recipient email addresses available for vessel '{target_vessel}'.",
        )

    # Build workbook
    wb = _build_vessel_pr_workbook(target_vessel, pr_type, filtered_items)
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    att_bytes = buf.getvalue()

    # Build HTML
    html_body = _build_vessel_pr_review_html(
        vessel_name=target_vessel,
        pr_type=pr_type,
        items=filtered_items,
        tsi_name=tsi_name,
        ta_name=ta_name,
        filename=att_filename,
    )

    try:
        send_mail(
            to_emails=recipients,
            subject=subject,
            html_body=html_body,
            from_mailbox="data@ozellar.com",
            cc_emails=cc_recipients,
            attachments=[
                {
                    "name": att_filename,
                    "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "contentBytes": att_bytes,
                }
            ],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send vessel PR review email: {e}",
        ) from e

    return SendVesselPrReviewEmailResponse(
        sent=True,
        vessel_name=target_vessel,
        pr_type=pr_type,
        recipients=recipients,
        cc_recipients=cc_recipients,
        subject=subject,
        from_mailbox="data@ozellar.com",
        attachment_filename=att_filename,
        items_count=len(filtered_items),
    )


@router.get("/filter-options", response_model=PendingItemsFilterOptions)
def get_pending_items_filter_options(db: Session = Depends(get_db)) -> PendingItemsFilterOptions:
    items = _compute_pending_items(db)
    return PendingItemsFilterOptions(
        vessel_name=sorted({i.vessel_name for i in items if i.vessel_name}),
        stage=sorted({i.stage for i in items if i.stage}),
        owner_name=sorted({i.owner_name for i in items if i.owner_name}),
        status=sorted({i.status for i in items if i.status}),
    )


_BLOCK_COLUMNS: list[tuple[str, int, Alignment]] = [
    ("Sl No.", 8, Alignment(horizontal="center", vertical="center")),
    ("Stage", 16, Alignment(horizontal="center", vertical="center")),
    ("Reference No.", 22, Alignment(horizontal="center", vertical="center")),
    ("Title / Description", 38, Alignment(horizontal="left", vertical="center", wrap_text=True)),
    ("Vendor", 26, Alignment(horizontal="left", vertical="center")),
    ("Status", 16, Alignment(horizontal="center", vertical="center")),
    ("Ageing (Days)", 14, Alignment(horizontal="center", vertical="center")),
    ("Reference Date", 16, Alignment(horizontal="center", vertical="center")),
]


def _build_pending_items_ageing_workbook(
    items: list[PendingItemOut],
    stage_filter: list[str] | None = None,
    role_filter: list[str] | None = None,
    search_filter: str | None = None,
    vessel_filter: list[str] | None = None,
    owner_filter: list[str] | None = None,
    ageing_bracket_filter: str | None = None,
) -> Workbook:
    """Build an interactive, modern standard Excel report (.xlsx) with 5 clean sheets:
    - Sheet 1 ('Ageing Summary'): A comprehensive matrix showing all vessels in rows,
      columns grouped by Ageing (0-30 Days, 30-90 Days, Above 90 Days) with TSI/TA
      separation. All non-zero counts are clickable hyperlinks without ugly underlines.
    - Sheet 2 ('0 - 30 Days'): Items <= 30 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 3 ('30 - 90 Days'): Items 31-90 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 4 ('Above 90 Days'): Critical items > 90 days pending, organized into dedicated visual cards / blocks per Vessel & In-charge.
    - Sheet 5 ('All Details'): Complete fleet items list, organized into dedicated visual cards / blocks per Vessel & In-charge.

    Clicking any cell count in the Summary matrix jumps directly to that specific Vessel & In-charge block!
    """
    workbook = Workbook()

    # ─────────────────────────────────────────────────────────────────────────
    # REFINED MODERN PROFESSIONAL PALETTE (Sophisticated & Harmonious)
    # ─────────────────────────────────────────────────────────────────────────
    NAVY_TOP = "0F2942"          # Deep Maritime Navy
    SLATE_SUBTITLE = "F8FAFC"    # Crisp light slate
    BORDER_LIGHT = "E2E8F0"      # Light slate border
    BORDER_CARD = "CBD5E1"       # Subtle card outline
    ZEBRA_FILL = "F8FAFC"        # Very subtle row alternation

    # Harmonious Header Colors (Balanced, corporate, elegant)
    COLOR_VESSEL_HDR = "1E293B"   # Slate 800 (used for TSI block headers & vessel columns)
    COLOR_VESSEL_SUB = "334155"   # Slate 700 (used for TA block headers & subheaders)
    COLOR_0_30_HDR = "1E3A8A"     # Deep Sapphire Navy
    COLOR_30_90_HDR = "854D0E"    # Refined Warm Bronze / Ochre
    COLOR_90_PLUS_HDR = "831843"  # Refined Deep Wine / Burgundy
    COLOR_TOTAL_HDR = "0F172A"    # Executive Charcoal Navy

    # Subheaders (Tier 2 in Summary)
    COLOR_0_30_SUB = "2563EB"
    COLOR_30_90_SUB = "B45309"
    COLOR_90_PLUS_SUB = "9F1239"
    COLOR_TOTAL_SUB = "1E293B"

    # Number Colors in Data Rows (NO UNDERLINE, Clean and Bold!)
    COLOR_0_30_NUM = "1E3A8A"
    COLOR_30_90_NUM = "854D0E"
    COLOR_90_PLUS_NUM = "831843"
    COLOR_TOTAL_NUM = "0F172A"

    # Soft Badge Colors in Detail Sheets
    PILL_0_30_BG = "EFF6FF"
    PILL_0_30_FG = "1E40AF"
    PILL_30_90_BG = "FEF3C7"
    PILL_30_90_FG = "92400E"
    PILL_90_PLUS_BG = "FCE7F3"
    PILL_90_PLUS_FG = "831843"

    # Fonts (Full 8-char ARGB hex for crisp rendering)
    font_title = Font(name="Calibri", size=14, bold=True, color="FFFFFFFF")
    font_subtitle = Font(name="Calibri", size=9, italic=True, color="FF475569")
    font_tier1 = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
    font_tier2 = Font(name="Calibri", size=9.5, bold=True, color="FFFFFFFF")
    font_vessel_name = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")
    font_incharge = Font(name="Calibri", size=9.5, color="FF475569")
    font_cell_muted = Font(name="Calibri", size=9.5, color="FF94A3B8")
    font_nav_back = Font(name="Calibri", size=9.5, bold=True, color="FFFFFFFF")
    font_detail_data = Font(name="Calibri", size=9.5, color="FF1E293B")
    font_detail_data_bold = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")

    font_block_hdr = Font(name="Calibri", size=11, bold=True, color="FFFFFFFF")
    font_block_subhdr = Font(name="Calibri", size=9, bold=True, color="FFFFFFFF")
    font_block_tot = Font(name="Calibri", size=9.5, bold=True, color="FF0F172A")

    # Fills
    fill_title = PatternFill("solid", fgColor=NAVY_TOP)
    fill_subtitle = PatternFill("solid", fgColor=SLATE_SUBTITLE)
    fill_white = PatternFill("solid", fgColor="FFFFFF")
    fill_zebra = PatternFill("solid", fgColor=ZEBRA_FILL)
    fill_grand = PatternFill("solid", fgColor=COLOR_TOTAL_HDR)

    # Borders
    border_cell = Border(
        left=Side(style="thin", color=BORDER_LIGHT),
        right=Side(style="thin", color=BORDER_LIGHT),
        top=Side(style="thin", color=BORDER_LIGHT),
        bottom=Side(style="thin", color=BORDER_LIGHT),
    )
    border_grand = Border(
        left=Side(style="thin", color=COLOR_TOTAL_HDR),
        right=Side(style="thin", color=COLOR_TOTAL_HDR),
        top=Side(style="medium", color=COLOR_TOTAL_HDR),
        bottom=Side(style="double", color=COLOR_TOTAL_HDR),
    )
    border_card = Border(
        left=Side(style="thin", color=BORDER_CARD),
        right=Side(style="thin", color=BORDER_CARD),
        top=Side(style="thin", color=BORDER_CARD),
        bottom=Side(style="thin", color=BORDER_CARD),
    )
    border_block_tot = Border(
        left=Side(style="thin", color=BORDER_CARD),
        right=Side(style="thin", color=BORDER_CARD),
        top=Side(style="thin", color=BORDER_CARD),
        bottom=Side(style="medium", color=COLOR_VESSEL_HDR),
    )

    align_center = Alignment(horizontal="center", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    align_text_wrap = Alignment(horizontal="left", vertical="center", wrap_text=True)

    def style_range(ws, min_col: int, min_row: int, max_col: int, max_row: int, fill=None, font=None, alignment=None, border=None):
        for r in range(min_row, max_row + 1):
            for c in range(min_col, max_col + 1):
                cell = ws.cell(row=r, column=c)
                if fill is not None:
                    cell.fill = fill
                if font is not None:
                    cell.font = font
                if alignment is not None:
                    cell.alignment = alignment
                if border is not None:
                    cell.border = border

    def set_link(cell, sheet_name: str, target_coord: str = "A1", font=None):
        cell.hyperlink = Hyperlink(ref=cell.coordinate, location=f"'{sheet_name}'!{target_coord}")
        if font is not None:
            cell.font = font

    # Classify items into buckets
    def bucket_key(age: int | None) -> str:
        if age is None or age <= 30:
            return "0_30"
        elif age <= 90:
            return "30_90"
        else:
            return "90_plus"

    items_0_30 = [i for i in items if bucket_key(i.ageing_days) == "0_30"]
    items_30_90 = [i for i in items if bucket_key(i.ageing_days) == "30_90"]
    items_90_plus = [i for i in items if bucket_key(i.ageing_days) == "90_plus"]

    # Active vessels list
    if vessel_filter:
        active_vessels = sorted({v.strip().upper() for v in vessel_filter if v.strip()})
    else:
        all_v = set(_VESSEL_OWNERS.keys())
        for itm in items:
            if itm.vessel_name:
                all_v.add(itm.vessel_name.strip().upper())
        active_vessels = sorted(all_v)

    # Subtitle metadata & active filters
    clean_roles = [r.strip().upper() for r in (role_filter or []) if r and r.strip().upper() != "ALL"]
    if clean_roles:
        role_label = f"{clean_roles[0]} Pending"
        role_banner_prefix = f"{clean_roles[0]} PENDING ITEMS"
    else:
        role_label = "All Pending (TSI & TA)"
        role_banner_prefix = "TSI / TA PENDING ITEMS"

    meta_parts: list[str] = []
    if stage_filter:
        meta_parts.append(f"Stage: {', '.join(stage_filter)}")
    meta_parts.append(f"Role: {role_label}")
    if vessel_filter:
        meta_parts.append(f"Vessels: {len(vessel_filter)} selected")
    if owner_filter:
        meta_parts.append(f"Owners: {', '.join(owner_filter)}")
    if ageing_bracket_filter:
        meta_parts.append(f"Bracket: {ageing_bracket_filter}")
    if search_filter:
        meta_parts.append(f"Search: '{search_filter}'")
    meta_parts.append(f"Generated: {datetime.now().strftime('%d-%b-%Y %H:%M')}")
    meta_parts.append(f"Total Pending: {len(items)}")
    subtitle_text = "   |   ".join(meta_parts)

    # For Invoice stage, items have no title/description (title=None). Omit column entirely!
    is_invoice = (
        (stage_filter and len(stage_filter) == 1 and stage_filter[0].strip().lower() == "invoice")
        or (bool(items) and all(i.stage == "Invoice" for i in items))
    )

    if is_invoice:
        block_columns: list[tuple[str, int, Alignment]] = [
            ("Sl No.", 8, align_center),
            ("Stage", 16, align_center),
            ("Reference No.", 24, align_center),
            ("Vendor", 32, align_left),
            ("Status", 18, align_center),
            ("Ageing (Days)", 14, align_center),
            ("Reference Date", 16, align_center),
        ]
    else:
        block_columns: list[tuple[str, int, Alignment]] = [
            ("Sl No.", 8, align_center),
            ("Stage", 16, align_center),
            ("Reference No.", 22, align_center),
            ("Title / Description", 38, align_text_wrap),
            ("Vendor", 26, align_left),
            ("Status", 16, align_center),
            ("Ageing (Days)", 14, align_center),
            ("Reference Date", 16, align_center),
        ]

    num_detail_cols = len(block_columns)

    # ─────────────────────────────────────────────────────────────────────────
    # Function to build detail sheets with DISTINCT VISUAL BLOCKS / CARDS
    # ─────────────────────────────────────────────────────────────────────────
    def build_block_detail_sheet(sheet_title: str, banner_label: str, hdr_color: str, sheet_items: list[PendingItemOut]) -> dict[tuple[str, str], int]:
        ws = workbook.create_sheet(title=sheet_title)
        ws.views.sheetView[0].showGridLines = True

        # Row 1: Return Button & Title
        ws.row_dimensions[1].height = 34
        ws.cell(row=1, column=1, value="⟵ Back to Summary")
        style_range(ws, 1, 1, 1, 1, fill=fill_title, font=font_nav_back, alignment=align_center)
        set_link(ws.cell(row=1, column=1), "Ageing Summary", "A1", font=font_nav_back)

        ws.merge_cells(start_row=1, start_column=2, end_row=1, end_column=num_detail_cols)
        ws.cell(row=1, column=2, value=banner_label)
        style_range(ws, 2, 1, num_detail_cols, 1, fill=PatternFill("solid", fgColor=hdr_color), font=font_title, alignment=align_center)

        # Row 2: Subtitle
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_detail_cols)
        ws.row_dimensions[2].height = 20
        ws.cell(row=2, column=1, value=f"{len(sheet_items)} item(s) in this view   |   Organized by Vessel & In-charge Blocks   |   Click '⟵ Back to Summary' in A1 anytime")
        style_range(ws, 1, 2, num_detail_cols, 2, fill=fill_subtitle, font=font_subtitle, alignment=align_center)

        # Row 3: Gap
        ws.row_dimensions[3].height = 6

        # Set column widths
        for col_idx, (_name, width, _al) in enumerate(block_columns, start=1):
            col_letter = get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = width

        # Group sheet_items by (vessel_name, owner_role)
        grouped: dict[str, dict[str, list[PendingItemOut]]] = defaultdict(lambda: defaultdict(list))
        for itm in sheet_items:
            v = (itm.vessel_name or "UNASSIGNED").strip().upper()
            role = (itm.owner_role or "UNASSIGNED").strip().upper()
            grouped[v][role].append(itm)

        # Sort items inside each group by ageing desc
        for v in grouped:
            for role in grouped[v]:
                grouped[v][role].sort(key=lambda x: (-(x.ageing_days if x.ageing_days is not None else -1), x.reference_no or ""))

        # Track row jumps: (vessel, role) -> row, and (vessel, "ALL") -> row
        row_map: dict[tuple[str, str], int] = {}
        curr_r = 4

        if not sheet_items:
            ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols)
            ws.row_dimensions[curr_r].height = 24
            ws.cell(row=curr_r, column=1, value=f"— No pending items match {sheet_title} bracket under current filters —")
            style_range(ws, 1, curr_r, num_detail_cols, curr_r, fill=fill_white, font=font_subtitle, alignment=align_center, border=border_cell)
            curr_r += 1
            ws.freeze_panes = "A4"
            return row_map

        ordered_vessels = list(active_vessels)
        for v in sorted(grouped.keys()):
            if v not in ordered_vessels:
                ordered_vessels.append(v)

        # Build each vessel & in-charge block
        for v_name in ordered_vessels:
            if v_name not in grouped:
                continue

            tsi_name, ta_name = _VESSEL_OWNERS.get(v_name, ("—", "—"))
            roles_order = [("TSI", tsi_name), ("TA", ta_name)]
            for r_extra in grouped[v_name]:
                if r_extra not in ("TSI", "TA"):
                    extra_owner = grouped[v_name][r_extra][0].owner_name if grouped[v_name][r_extra] else "—"
                    roles_order.append((r_extra, extra_owner or "—"))

            for role_key, owner_name in roles_order:
                b_items = grouped[v_name].get(role_key, [])
                if not b_items:
                    continue

                # 1. Block Header Banner (Prominently Highlighted!)
                ws.row_dimensions[curr_r].height = 28
                ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols)
                block_title = f"  ■  {v_name}   |   {role_key} IN-CHARGE: {owner_name}   |   {len(b_items)} Item(s) Pending"
                ws.cell(row=curr_r, column=1, value=block_title)

                # Rich vibrant distinctive highlights: Sapphire Blue for TSI, Royal Amethyst Purple for TA
                if role_key == "TSI":
                    hdr_color = "1E3A8A"
                elif role_key == "TA":
                    hdr_color = "581C87"
                else:
                    hdr_color = "334155"

                hdr_fill = PatternFill("solid", fgColor=hdr_color)
                style_range(ws, 1, curr_r, num_detail_cols, curr_r, fill=hdr_fill, font=font_block_hdr, alignment=align_left)

                # Record coordinate for hyperlinks
                row_map[(v_name, role_key)] = curr_r
                if (v_name, "ALL") not in row_map:
                    row_map[(v_name, "ALL")] = curr_r

                curr_r += 1

                # 2. Block Mini-Table Headers (Dark executive slate for strong contrast with block banner)
                ws.row_dimensions[curr_r].height = 22
                for col_idx, (col_name, _w, _al) in enumerate(block_columns, start=1):
                    c = ws.cell(row=curr_r, column=col_idx, value=col_name)
                    c.fill = PatternFill("solid", fgColor="1E293B")
                    c.font = font_block_subhdr
                    c.alignment = align_center
                    c.border = border_cell
                curr_r += 1

                # 3. Block Data Rows
                for b_idx, itm in enumerate(b_items, start=1):
                    ws.row_dimensions[curr_r].height = 20
                    row_fill = fill_white if b_idx % 2 != 0 else fill_zebra

                    age = itm.ageing_days
                    if age is None or age <= 30:
                        age_pill = PatternFill("solid", fgColor=PILL_0_30_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_0_30_FG)
                    elif age <= 90:
                        age_pill = PatternFill("solid", fgColor=PILL_30_90_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_30_90_FG)
                    else:
                        age_pill = PatternFill("solid", fgColor=PILL_90_PLUS_BG)
                        age_font = Font(name="Calibri", size=9.5, bold=True, color=PILL_90_PLUS_FG)

                    ref_date_val = itm.reference_date
                    if isinstance(ref_date_val, datetime):
                        ref_date_val = ref_date_val.date()

                    if is_invoice:
                        row_vals = [
                            (b_idx, align_center, font_detail_data_bold, row_fill, None),
                            (itm.stage or "—", align_center, font_detail_data, row_fill, None),
                            (itm.reference_no or "—", align_center, font_detail_data_bold, row_fill, None),
                            (itm.vendor or "—", align_left, font_detail_data, row_fill, None),
                            (itm.status or "—", align_center, font_detail_data, row_fill, None),
                            (f"{itm.ageing_days}d" if itm.ageing_days is not None else "—", align_center, age_font, age_pill, None),
                            (ref_date_val if isinstance(ref_date_val, (date, datetime)) else "—", align_center, font_detail_data, row_fill, "DD-MMM-YYYY" if isinstance(ref_date_val, (date, datetime)) else None),
                        ]
                    else:
                        row_vals = [
                            (b_idx, align_center, font_detail_data_bold, row_fill, None),
                            (itm.stage or "—", align_center, font_detail_data, row_fill, None),
                            (itm.reference_no or "—", align_center, font_detail_data_bold, row_fill, None),
                            (itm.title or "—", align_text_wrap, font_detail_data, row_fill, None),
                            (itm.vendor or "—", align_left, font_detail_data, row_fill, None),
                            (itm.status or "—", align_center, font_detail_data, row_fill, None),
                            (f"{itm.ageing_days}d" if itm.ageing_days is not None else "—", align_center, age_font, age_pill, None),
                            (ref_date_val if isinstance(ref_date_val, (date, datetime)) else "—", align_center, font_detail_data, row_fill, "DD-MMM-YYYY" if isinstance(ref_date_val, (date, datetime)) else None),
                        ]

                    for col_idx, (val, al, fnt, fll, num_fmt) in enumerate(row_vals, start=1):
                        c = ws.cell(row=curr_r, column=col_idx, value=val)
                        c.alignment = al
                        c.font = fnt
                        c.fill = fll
                        c.border = border_cell
                        if num_fmt:
                            c.number_format = num_fmt

                    curr_r += 1

                # 4. Block Subtotal Row
                ws.row_dimensions[curr_r].height = 20
                ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols - 2)
                ws.cell(row=curr_r, column=1, value=f"   Subtotal {v_name} ({role_key} - {owner_name})")
                style_range(ws, 1, curr_r, num_detail_cols - 2, curr_r, fill=PatternFill("solid", fgColor="F1F5F9"), font=font_block_tot, alignment=align_left, border=border_block_tot)

                ws.merge_cells(start_row=curr_r, start_column=num_detail_cols - 1, end_row=curr_r, end_column=num_detail_cols)
                ws.cell(row=curr_r, column=num_detail_cols - 1, value=f"{len(b_items)} item(s)")
                style_range(ws, num_detail_cols - 1, curr_r, num_detail_cols, curr_r, fill=PatternFill("solid", fgColor="F1F5F9"), font=font_block_tot, alignment=align_center, border=border_block_tot)
                curr_r += 1

                # 5. Spacer between blocks (creates the visual card / block feel!)
                ws.row_dimensions[curr_r].height = 12
                curr_r += 1

        # Sheet Grand Total Row
        ws.row_dimensions[curr_r].height = 24
        ws.merge_cells(start_row=curr_r, start_column=1, end_row=curr_r, end_column=num_detail_cols - 2)
        ws.cell(row=curr_r, column=1, value=f"   TOTAL {sheet_title.upper()} ITEMS")
        style_range(ws, 1, curr_r, num_detail_cols - 2, curr_r, fill=fill_grand, font=font_tier1, alignment=align_left, border=border_grand)

        ws.merge_cells(start_row=curr_r, start_column=num_detail_cols - 1, end_row=curr_r, end_column=num_detail_cols)
        ws.cell(row=curr_r, column=num_detail_cols - 1, value=f"{len(sheet_items)} item(s)")
        style_range(ws, num_detail_cols - 1, curr_r, num_detail_cols, curr_r, fill=fill_grand, font=font_tier1, alignment=align_center, border=border_grand)

        # Freeze panes at row 4 so Rows 1-3 stay pinned at top
        ws.freeze_panes = "A4"

        return row_map

    # Build the 4 detail sheets with distinct block layout and track coordinates
    # Ordering: 90+ first, then 30 to 90, then below 30
    d_role = clean_roles[0] if clean_roles else None
    all_hdr_color = "1E3A8A" if d_role == "TSI" else ("581C87" if d_role == "TA" else COLOR_TOTAL_HDR)

    map_90_plus = build_block_detail_sheet("Above 90 Days", f"{role_banner_prefix} — 90+ DAYS (CRITICAL)", COLOR_90_PLUS_HDR, items_90_plus)
    map_30_90 = build_block_detail_sheet("30 - 90 Days", f"{role_banner_prefix} — 30 TO 90 DAYS (ATTENTION)", COLOR_30_90_HDR, items_30_90)
    map_0_30 = build_block_detail_sheet("Below 30 Days", f"{role_banner_prefix} — BELOW 30 DAYS (NORMAL)", "6D28D9" if d_role == "TA" else COLOR_0_30_HDR, items_0_30)
    map_all = build_block_detail_sheet("All Details", f"{role_banner_prefix} — ALL DETAILED ITEMS", all_hdr_color, items)

    # ─────────────────────────────────────────────────────────────────────────
    # Sheet 1: The Main Vessel Matrix Summary Table
    # ─────────────────────────────────────────────────────────────────────────
    ws_main = workbook.active
    ws_main.title = "Ageing Summary"
    ws_main.views.sheetView[0].showGridLines = True

    single_role = clean_roles[0] if len(clean_roles) == 1 and clean_roles[0] in ("TSI", "TA") else None
    TOTAL_COLS = 6 if single_role else 15

    # 1. Main Title Banner
    stage_upper = " / ".join(stage_filter).upper() if stage_filter else ""
    if stage_upper and single_role:
        summary_main_title = f"{stage_upper} ({single_role} PENDING) — VESSEL AGEING MATRIX"
    elif stage_upper:
        summary_main_title = f"{stage_upper} (ALL PENDING) — VESSEL AGEING MATRIX"
    elif single_role:
        summary_main_title = f"{single_role} PENDING ITEMS — VESSEL AGEING MATRIX"
    else:
        summary_main_title = "TSI / TA PENDING ITEMS — VESSEL AGEING MATRIX"

    title_bg = "1E3A8A" if single_role == "TSI" else ("581C87" if single_role == "TA" else NAVY_TOP)
    fill_summary_title = PatternFill("solid", fgColor=title_bg)

    ws_main.merge_cells(start_row=1, start_column=1, end_row=1, end_column=TOTAL_COLS)
    ws_main.row_dimensions[1].height = 36
    ws_main.cell(row=1, column=1, value=summary_main_title)
    style_range(ws_main, 1, 1, TOTAL_COLS, 1, fill=fill_summary_title, font=font_title, alignment=align_center)

    # 2. Subtitle Banner
    ws_main.merge_cells(start_row=2, start_column=1, end_row=2, end_column=TOTAL_COLS)
    ws_main.row_dimensions[2].height = 20
    ws_main.cell(row=2, column=1, value=f"{subtitle_text}   |   Tip: Click any number to jump directly to that vessel & in-charge block")
    style_range(ws_main, 1, 2, TOTAL_COLS, 2, fill=fill_subtitle, font=font_subtitle, alignment=align_center)

    ws_main.row_dimensions[3].height = 8

    # 3. KPI Summary Cards (Minimalist & Clean)
    ws_main.row_dimensions[4].height = 16
    ws_main.row_dimensions[5].height = 24

    if single_role == "TSI":
        kpi_defs = [
            ("TOTAL TSI PENDING", len(items), "FFFFFF", "1E3A8A", 1, 2, "All Details"),
            ("90+ DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 3, 3, "Above 90 Days"),
            ("30 TO 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 4, 4, "30 - 90 Days"),
            ("BELOW 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", COLOR_0_30_HDR, 5, 6, "Below 30 Days"),
        ]
    elif single_role == "TA":
        kpi_defs = [
            ("TOTAL TA PENDING", len(items), "FFFFFF", "581C87", 1, 2, "All Details"),
            ("90+ DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 3, 3, "Above 90 Days"),
            ("30 TO 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 4, 4, "30 - 90 Days"),
            ("BELOW 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", "6D28D9", 5, 6, "Below 30 Days"),
        ]
    else:
        kpi_defs = [
            ("TOTAL FLEET PENDING", len(items), "FFFFFF", COLOR_TOTAL_HDR, 2, 4, "All Details"),
            ("90+ DAYS (CRITICAL)", len(items_90_plus), "FFFFFF", COLOR_90_PLUS_HDR, 5, 7, "Above 90 Days"),
            ("30 TO 90 DAYS (ATTENTION)", len(items_30_90), "FFFFFF", COLOR_30_90_HDR, 8, 10, "30 - 90 Days"),
            ("BELOW 30 DAYS (NORMAL)", len(items_0_30), "FFFFFF", COLOR_0_30_HDR, 11, 13, "Below 30 Days"),
        ]

    for label, count_val, bg_hex, fg_hex, c_start, c_end, target_sheet in kpi_defs:
        if c_end > c_start:
            ws_main.merge_cells(start_row=4, start_column=c_start, end_row=4, end_column=c_end)
        ws_main.cell(row=4, column=c_start, value=label)
        style_range(ws_main, c_start, 4, c_end, 4, fill=PatternFill("solid", fgColor=bg_hex), font=Font(name="Calibri", size=8.5, bold=True, color="FF64748B"), alignment=align_center, border=border_card)

        if c_end > c_start:
            ws_main.merge_cells(start_row=5, start_column=c_start, end_row=5, end_column=c_end)
        c_val = ws_main.cell(row=5, column=c_start, value=count_val)
        f_kpi = Font(name="Calibri", size=14, bold=True, color=f"FF{fg_hex}")
        style_range(ws_main, c_start, 5, c_end, 5, fill=PatternFill("solid", fgColor=bg_hex), font=f_kpi, alignment=align_center, border=border_card)
        set_link(c_val, target_sheet, "A1", font=f_kpi)

    ws_main.row_dimensions[6].height = 12

    # 4. Table Header Tier 1 (Category Banners) — Pure bold white text, NO hyperlinks
    ws_main.row_dimensions[7].height = 28

    if single_role == "TSI":
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 2, "1E293B"),
            ("90+ DAYS (CRITICAL)", 3, 3, "BE123C"),
            ("30 TO 90 DAYS (ATTENTION)", 4, 4, "B45309"),
            ("BELOW 30 DAYS (NORMAL)", 5, 5, "1E40AF"),
            ("TOTAL PENDING", 6, 6, "1E3A8A"),
        ]
    elif single_role == "TA":
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 2, "1E293B"),
            ("90+ DAYS (CRITICAL)", 3, 3, "BE123C"),
            ("30 TO 90 DAYS (ATTENTION)", 4, 4, "B45309"),
            ("BELOW 30 DAYS (NORMAL)", 5, 5, "6D28D9"),
            ("TOTAL PENDING", 6, 6, "581C87"),
        ]
    else:
        tier1_groups = [
            ("VESSEL & IN-CHARGE", 1, 3, "1E293B"),
            ("90+ DAYS (CRITICAL)", 4, 6, "BE123C"),
            ("30 TO 90 DAYS (ATTENTION)", 7, 9, "B45309"),
            ("BELOW 30 DAYS (NORMAL)", 10, 12, "1E40AF"),
            ("TOTAL PENDING", 13, 15, "0F2942"),
        ]

    for title_text, c_start, c_end, color_hex in tier1_groups:
        if c_end > c_start:
            ws_main.merge_cells(start_row=7, start_column=c_start, end_row=7, end_column=c_end)
        ws_main.cell(row=7, column=c_start, value=title_text)
        style_range(
            ws_main,
            c_start,
            7,
            c_end,
            7,
            fill=PatternFill("solid", fgColor=color_hex),
            font=Font(name="Calibri", size=10.5, bold=True, color="FFFFFFFF"),
            alignment=align_center,
            border=border_cell,
        )

    # 5. Table Header Tier 2 (Column Headers) — High-contrast bold white text, NO hyperlinks
    ws_main.row_dimensions[8].height = 24

    if single_role == "TSI":
        tier2_cols = [
            ("Vessel Name", 24, align_left, "1E293B", 9.5),
            ("TSI In-charge", 18, align_center, "1E3A8A", 9.5),
            ("90+", 16, align_center, "E11D48", 9.5),
            ("30-90", 16, align_center, "D97706", 9.5),
            ("<30", 16, align_center, "2563EB", 9.5),
            ("TSI Total", 16, align_center, "1E3A8A", 9.5),
        ]
    elif single_role == "TA":
        tier2_cols = [
            ("Vessel Name", 24, align_left, "1E293B", 9.5),
            ("TA In-charge", 18, align_center, "581C87", 9.5),
            ("90+", 16, align_center, "E11D48", 9.5),
            ("30-90", 16, align_center, "D97706", 9.5),
            ("<30", 16, align_center, "7C3AED", 9.5),
            ("TA Total", 16, align_center, "581C87", 9.5),
        ]
    else:
        tier2_cols = [
            ("Vessel Name", 22, align_left, "1E293B", 9.5),
            ("TSI In-charge", 16, align_center, "1E3A8A", 9.5),
            ("TA In-charge", 16, align_center, "581C87", 9.5),
            # 90+ Days
            ("TSI", 10, align_center, "E11D48", 9.5),
            ("TA", 10, align_center, "C026D3", 9.5),
            ("Total", 11, align_center, "BE123C", 9.5),
            # 30 to 90 Days
            ("TSI", 10, align_center, "D97706", 9.5),
            ("TA", 10, align_center, "8B5CF6", 9.5),
            ("Total", 11, align_center, "B45309", 9.5),
            # Below 30 Days
            ("TSI", 10, align_center, "2563EB", 9.5),
            ("TA", 10, align_center, "7C3AED", 9.5),
            ("Total", 11, align_center, "1D4ED8", 9.5),
            # Total Pending
            ("TSI Total", 12, align_center, "1E3A8A", 9.5),
            ("TA Total", 12, align_center, "581C87", 9.5),
            ("Fleet Total", 13, align_center, "0F172A", 10.0),
        ]

    for col_idx, (col_name, width, al, bg_hex, f_size) in enumerate(tier2_cols, start=1):
        cell = ws_main.cell(row=8, column=col_idx, value=col_name)
        cell.fill = PatternFill("solid", fgColor=bg_hex)
        cell.font = Font(name="Calibri", size=f_size, bold=True, color="FFFFFFFF")
        cell.alignment = align_center
        cell.border = border_cell
        col_letter = get_column_letter(col_idx)
        ws_main.column_dimensions[col_letter].width = width

    # Organize counts per vessel for summary table
    vessel_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for item in items:
        v = (item.vessel_name or "").strip().upper()
        b = bucket_key(item.ageing_days)
        role = (item.owner_role or "").strip().upper()
        if role in ("TSI", "TA"):
            vessel_counts[v][f"{b}_{role.lower()}"] += 1
            vessel_counts[v][f"{b}_tot"] += 1
            vessel_counts[v][f"tot_{role.lower()}"] += 1
            vessel_counts[v]["tot_all"] += 1

    # 6. Data Rows (Vessels)
    curr_row = 9
    fleet_sums = defaultdict(int)

    for idx, v_name in enumerate(active_vessels, start=1):
        ws_main.row_dimensions[curr_row].height = 21
        row_fill = fill_white if idx % 2 != 0 else fill_zebra

        tsi_incharge, ta_incharge = _VESSEL_OWNERS.get(v_name, ("—", "—"))
        vc = vessel_counts[v_name]

        c_0_30_tsi = vc["0_30_tsi"]
        c_0_30_ta = vc["0_30_ta"]
        c_0_30_tot = vc["0_30_tot"]

        c_30_90_tsi = vc["30_90_tsi"]
        c_30_90_ta = vc["30_90_ta"]
        c_30_90_tot = vc["30_90_tot"]

        c_90_tsi = vc["90_plus_tsi"]
        c_90_ta = vc["90_plus_ta"]
        c_90_tot = vc["90_plus_tot"]

        c_tot_tsi = vc["tot_tsi"]
        c_tot_ta = vc["tot_ta"]
        c_tot_all = vc["tot_all"]

        fleet_sums["0_30_tsi"] += c_0_30_tsi
        fleet_sums["0_30_ta"] += c_0_30_ta
        fleet_sums["0_30_tot"] += c_0_30_tot

        fleet_sums["30_90_tsi"] += c_30_90_tsi
        fleet_sums["30_90_ta"] += c_30_90_ta
        fleet_sums["30_90_tot"] += c_30_90_tot

        fleet_sums["90_plus_tsi"] += c_90_tsi
        fleet_sums["90_plus_ta"] += c_90_ta
        fleet_sums["90_plus_tot"] += c_90_tot

        fleet_sums["tot_tsi"] += c_tot_tsi
        fleet_sums["tot_ta"] += c_tot_ta
        fleet_sums["tot_all"] += c_tot_all

        # Determine exact row coordinates in detail sheets
        r_0_30_tsi = map_0_30.get((v_name, "TSI"))
        r_0_30_ta = map_0_30.get((v_name, "TA"))
        r_0_30_all = map_0_30.get((v_name, "ALL"))

        r_30_90_tsi = map_30_90.get((v_name, "TSI"))
        r_30_90_ta = map_30_90.get((v_name, "TA"))
        r_30_90_all = map_30_90.get((v_name, "ALL"))

        r_90_tsi = map_90_plus.get((v_name, "TSI"))
        r_90_ta = map_90_plus.get((v_name, "TA"))
        r_90_all = map_90_plus.get((v_name, "ALL"))

        r_all_tsi = map_all.get((v_name, "TSI"))
        r_all_ta = map_all.get((v_name, "TA"))
        r_all_all = map_all.get((v_name, "ALL"))

        target_row_for_vessel = r_all_tsi if single_role == "TSI" else (r_all_ta if single_role == "TA" else r_all_all)

        # Vessel name cell (links to that vessel's block in All Details) — Prominently bold
        v_cell = ws_main.cell(row=curr_row, column=1, value=v_name)
        v_cell.font = Font(name="Calibri", size=10, bold=True, color="FF0F172A")
        v_cell.alignment = align_left
        v_cell.fill = row_fill
        v_cell.border = border_cell
        if target_row_for_vessel:
            set_link(v_cell, "All Details", f"A{target_row_for_vessel}", font=Font(name="Calibri", size=10, bold=True, color="FF0F172A"))

        if single_role == "TSI":
            # TSI In-charge (Col 2)
            cell_tsi = ws_main.cell(row=curr_row, column=2, value=tsi_incharge)
            cell_tsi.font = Font(name="Calibri", size=9.5, bold=True, color="FF1E40AF")
            cell_tsi.alignment = align_center
            cell_tsi.fill = row_fill
            cell_tsi.border = border_cell

            count_mappings = [
                (3, c_90_tsi, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_tsi}" if r_90_tsi else None),
                (4, c_30_90_tsi, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_tsi}" if r_30_90_tsi else None),
                (5, c_0_30_tsi, COLOR_0_30_NUM, "Below 30 Days", f"A{r_0_30_tsi}" if r_0_30_tsi else None),
                (6, c_tot_tsi, COLOR_TOTAL_NUM, "All Details", f"A{r_all_tsi}" if r_all_tsi else None),
            ]
        elif single_role == "TA":
            # TA In-charge (Col 2)
            cell_ta = ws_main.cell(row=curr_row, column=2, value=ta_incharge)
            cell_ta.font = Font(name="Calibri", size=9.5, bold=True, color="FF6D28D9")
            cell_ta.alignment = align_center
            cell_ta.fill = row_fill
            cell_ta.border = border_cell

            count_mappings = [
                (3, c_90_ta, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_ta}" if r_90_ta else None),
                (4, c_30_90_ta, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_ta}" if r_30_90_ta else None),
                (5, c_0_30_ta, "6D28D9", "Below 30 Days", f"A{r_0_30_ta}" if r_0_30_ta else None),
                (6, c_tot_ta, "581C87", "All Details", f"A{r_all_ta}" if r_all_ta else None),
            ]
        else:
            # Full 15-column matrix
            # TSI In-charge (Col 2)
            cell_tsi = ws_main.cell(row=curr_row, column=2, value=tsi_incharge)
            cell_tsi.font = Font(name="Calibri", size=9.5, bold=True, color="FF1E40AF")
            cell_tsi.alignment = align_center
            cell_tsi.fill = row_fill
            cell_tsi.border = border_cell

            # TA In-charge (Col 3)
            cell_ta = ws_main.cell(row=curr_row, column=3, value=ta_incharge)
            cell_ta.font = Font(name="Calibri", size=9.5, bold=True, color="FF6D28D9")
            cell_ta.alignment = align_center
            cell_ta.fill = row_fill
            cell_ta.border = border_cell

            count_mappings = [
                (4, c_90_tsi, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_tsi}" if r_90_tsi else None),
                (5, c_90_ta, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_ta}" if r_90_ta else None),
                (6, c_90_tot, COLOR_90_PLUS_NUM, "Above 90 Days", f"A{r_90_all}" if r_90_all else None),

                (7, c_30_90_tsi, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_tsi}" if r_30_90_tsi else None),
                (8, c_30_90_ta, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_ta}" if r_30_90_ta else None),
                (9, c_30_90_tot, COLOR_30_90_NUM, "30 - 90 Days", f"A{r_30_90_all}" if r_30_90_all else None),

                (10, c_0_30_tsi, COLOR_0_30_NUM, "Below 30 Days", f"A{r_0_30_tsi}" if r_0_30_tsi else None),
                (11, c_0_30_ta, "6D28D9", "Below 30 Days", f"A{r_0_30_ta}" if r_0_30_ta else None),
                (12, c_0_30_tot, COLOR_0_30_NUM, "Below 30 Days", f"A{r_0_30_all}" if r_0_30_all else None),

                (13, c_tot_tsi, "1E3A8A", "All Details", f"A{r_all_tsi}" if r_all_tsi else None),
                (14, c_tot_ta, "581C87", "All Details", f"A{r_all_ta}" if r_all_ta else None),
                (15, c_tot_all, COLOR_TOTAL_NUM, "All Details", f"A{r_all_all}" if r_all_all else None),
            ]

        for col_idx, cnt, num_color, tgt_sheet, tgt_coord in count_mappings:
            cell = ws_main.cell(row=curr_row, column=col_idx)
            cell.alignment = align_center
            cell.fill = row_fill
            cell.border = border_cell

            if cnt == 0:
                cell.value = "—"
                cell.font = font_cell_muted
            else:
                cell.value = cnt
                # NO UNDERLINE! Clean, bold, elegant number!
                f_num = Font(name="Calibri", size=10, bold=True, color=f"FF{num_color}")
                cell.font = f_num

                if tgt_sheet and tgt_coord:
                    set_link(cell, tgt_sheet, tgt_coord, font=f_num)

        curr_row += 1

    # 7. Bottom Fleet Total Row — High-contrast bold white text, NO hyperlinks
    label_cols = 2 if single_role else 3
    ws_main.merge_cells(start_row=curr_row, start_column=1, end_row=curr_row, end_column=label_cols)
    ws_main.row_dimensions[curr_row].height = 26
    ws_main.cell(row=curr_row, column=1, value="   FLEET GRAND TOTAL")
    fleet_grand_bg = "1E3A8A" if single_role == "TSI" else ("581C87" if single_role == "TA" else COLOR_TOTAL_HDR)
    fill_fleet_grand = PatternFill("solid", fgColor=fleet_grand_bg)
    border_fleet_grand = Border(
        left=Side(style="thin", color=fleet_grand_bg),
        right=Side(style="thin", color=fleet_grand_bg),
        top=Side(style="medium", color=fleet_grand_bg),
        bottom=Side(style="double", color=fleet_grand_bg),
    )
    style_range(ws_main, 1, curr_row, label_cols, curr_row, fill=fill_fleet_grand, font=Font(name="Calibri", size=10, bold=True, color="FFFFFFFF"), alignment=align_left, border=border_fleet_grand)

    if single_role == "TSI":
        fleet_col_map = [
            (3, fleet_sums["90_plus_tsi"]),
            (4, fleet_sums["30_90_tsi"]),
            (5, fleet_sums["0_30_tsi"]),
            (6, fleet_sums["tot_tsi"]),
        ]
    elif single_role == "TA":
        fleet_col_map = [
            (3, fleet_sums["90_plus_ta"]),
            (4, fleet_sums["30_90_ta"]),
            (5, fleet_sums["0_30_ta"]),
            (6, fleet_sums["tot_ta"]),
        ]
    else:
        fleet_col_map = [
            (4, fleet_sums["90_plus_tsi"]),
            (5, fleet_sums["90_plus_ta"]),
            (6, fleet_sums["90_plus_tot"]),
            (7, fleet_sums["30_90_tsi"]),
            (8, fleet_sums["30_90_ta"]),
            (9, fleet_sums["30_90_tot"]),
            (10, fleet_sums["0_30_tsi"]),
            (11, fleet_sums["0_30_ta"]),
            (12, fleet_sums["0_30_tot"]),
            (13, fleet_sums["tot_tsi"]),
            (14, fleet_sums["tot_ta"]),
            (15, fleet_sums["tot_all"]),
        ]

    for col_idx, tot_val in fleet_col_map:
        cell = ws_main.cell(row=curr_row, column=col_idx, value=tot_val)
        cell.fill = fill_fleet_grand
        cell.font = Font(name="Calibri", size=10, bold=True, color="FFFFFFFF")
        cell.alignment = align_center
        cell.border = border_fleet_grand

    # Freeze panes on summary sheet at row 9 so headers stay locked
    ws_main.freeze_panes = "A9"

    # Ensure Ageing Summary is active tab when opened
    workbook.active = ws_main

    return workbook


@router.get("/export")
def export_pending_items(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_name: list[str] | None = Query(default=None),
    stage: list[str] | None = Query(default=None),
    owner_role: list[str] | None = Query(default=None),
    owner_name: list[str] | None = Query(default=None),
    ageing_bracket: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    items = _sorted(
        _filtered(_compute_pending_items(db), search, vessel_name, stage, owner_role, owner_name, ageing_bracket),
        sort_by,
        sort_dir,
    )

    workbook = _build_pending_items_ageing_workbook(
        items=items,
        stage_filter=stage,
        role_filter=owner_role,
        search_filter=search,
        vessel_filter=vessel_name,
        owner_filter=owner_name,
        ageing_bracket_filter=ageing_bracket,
    )

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)

    # Frontend sends stage + optional owner_role (its tab/sub-tab selection), so
    # name the file after them; falls back to a generic name for any other combination.
    stage_clean = [s for s in (stage or []) if s]
    role_clean = [r.strip().upper() for r in (owner_role or []) if r and r.strip().upper() != "ALL"]
    if len(stage_clean) == 1 and len(role_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_{role_clean[0]}_Pending_Ageing.xlsx"
    elif len(stage_clean) == 1:
        filename = f"{stage_clean[0].replace(' ', '_')}_All_Pending_Ageing.xlsx"
    elif len(role_clean) == 1:
        filename = f"Fleet_{role_clean[0]}_Pending_Ageing.xlsx"
    else:
        filename = "Fleet_All_Pending_Ageing.xlsx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _build_pending_items_html_summary(
    items: list[PendingItemOut],
    role_label: str = "ALL",
    filename: str = "report.xlsx",
    stage_label: str | None = None,
) -> str:
    single_role = role_label.upper() if role_label.upper() in ("TSI", "TA") else None
    role_norm = single_role or "ALL"

    active_vessels = list(_VESSEL_OWNERS.keys())

    def _bucket(days: int | None) -> str:
        if days is None:
            return "0_30"
        if days <= 30:
            return "0_30"
        elif days <= 90:
            return "30_90"
        return "90_plus"

    if single_role:
        scoped_items = [i for i in items if (i.owner_role or "").upper() == single_role]
    else:
        scoped_items = items

    if stage_label:
        scoped_items = [i for i in scoped_items if (i.stage or "").upper() == stage_label.upper()]

    tot_items = len(scoped_items)
    tot_0_30 = len([i for i in scoped_items if _bucket(i.ageing_days) == "0_30"])
    tot_30_90 = len([i for i in scoped_items if _bucket(i.ageing_days) == "30_90"])
    tot_90_plus = len([i for i in scoped_items if _bucket(i.ageing_days) == "90_plus"])

    theme_bg = "#1E3A8A" if role_norm == "TSI" else ("#581C87" if role_norm == "TA" else "#0F2942")
    role_title = f"{role_norm} PENDING ITEMS — VESSEL AGEING MATRIX"
    if stage_label:
        role_title += f" ({stage_label.upper()})"

    now_str = datetime.now().strftime("%d %b %Y, %I:%M %p")

    vessel_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for item in items:
        if stage_label and (item.stage or "").upper() != stage_label.upper():
            continue
        v = (item.vessel_name or "").strip().upper()
        b = _bucket(item.ageing_days)
        r = (item.owner_role or "").strip().upper()
        if r in ("TSI", "TA"):
            vessel_counts[v][f"{b}_{r.lower()}"] += 1
            vessel_counts[v][f"{b}_tot"] += 1
            vessel_counts[v][f"tot_{r.lower()}"] += 1
            vessel_counts[v]["tot_all"] += 1

    html = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1E293B; margin: 0; padding: 20px; background-color: #F8FAFC;">
      <div style="max-width: 960px; margin: 0 auto; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background-color: {theme_bg}; color: #FFFFFF; padding: 24px; text-align: center;">
          <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">{role_title}</h1>
          <div style="font-size: 13px; opacity: 0.9;">PI Follow-up Tracker &bull; Generated on {now_str} &bull; Active Fleet: {len(active_vessels)} Vessels</div>
        </div>

        <div style="padding: 16px; background-color: #F1F5F9; border-bottom: 1px solid #CBD5E1;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 10px; text-align: center;">
            <tr>
              <td style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">TOTAL PENDING</div>
                <div style="font-size: 24px; font-weight: 800; color: {theme_bg}; margin-top: 4px;">{tot_items}</div>
              </td>
              <td style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">90+ DAYS (CRITICAL)</div>
                <div style="font-size: 24px; font-weight: 800; color: #BE123C; margin-top: 4px;">{tot_90_plus}</div>
              </td>
              <td style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">30 TO 90 DAYS (ATTENTION)</div>
                <div style="font-size: 24px; font-weight: 800; color: #D97706; margin-top: 4px;">{tot_30_90}</div>
              </td>
              <td style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase;">BELOW 30 DAYS (NORMAL)</div>
                <div style="font-size: 24px; font-weight: 800; color: #2563EB; margin-top: 4px;">{tot_0_30}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding: 20px;">
          <h2 style="font-size: 14px; font-weight: 700; margin: 0 0 12px 0; color: #0F172A; text-transform: uppercase; letter-spacing: 0.5px;">
            Vessel Ageing Breakdown
          </h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #CBD5E1;">
    """

    fleet_sums = defaultdict(int)

    if role_norm == "TSI":
        html += """
            <thead>
              <tr style="background-color: #1E293B; color: #FFFFFF; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 10px 12px; text-align: left; border: 1px solid #CBD5E1;">Vessel Name</th>
                <th style="padding: 10px 12px; text-align: center; border: 1px solid #CBD5E1;">TSI In-Charge</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #BE123C; border: 1px solid #CBD5E1;">90+ Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #B45309; border: 1px solid #CBD5E1;">30 to 90 Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #1E40AF; border: 1px solid #CBD5E1;">Below 30 Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #1E3A8A; border: 1px solid #CBD5E1;">TSI Total</th>
              </tr>
            </thead>
            <tbody>
        """
        for idx, v_name in enumerate(active_vessels):
            tsi_inc, _ = _VESSEL_OWNERS.get(v_name, ("—", "—"))
            vc = vessel_counts[v_name]
            c_0_30 = vc["0_30_tsi"]
            c_30_90 = vc["30_90_tsi"]
            c_90 = vc["90_plus_tsi"]
            c_tot = vc["tot_tsi"]

            fleet_sums["0_30"] += c_0_30
            fleet_sums["30_90"] += c_30_90
            fleet_sums["90"] += c_90
            fleet_sums["tot"] += c_tot

            row_bg = "#FFFFFF" if idx % 2 == 0 else "#F8FAFC"
            html += f"""
              <tr style="background-color: {row_bg};">
                <td style="padding: 8px 12px; font-weight: 700; color: #0F172A; border: 1px solid #E2E8F0;">{v_name}</td>
                <td style="padding: 8px 12px; text-align: center; font-weight: 600; color: #1E40AF; border: 1px solid #E2E8F0;">{tsi_inc}</td>
                <td style="padding: 8px 12px; text-align: center; color: #E11D48; font-weight: 600; border: 1px solid #E2E8F0;">{c_90 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; color: #D97706; font-weight: 600; border: 1px solid #E2E8F0;">{c_30_90 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; color: #2563EB; font-weight: 600; border: 1px solid #E2E8F0;">{c_0_30 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; font-weight: 700; color: #1E3A8A; border: 1px solid #E2E8F0;">{c_tot or "—"}</td>
              </tr>
            """
        html += f"""
            </tbody>
            <tfoot>
              <tr style="background-color: #E2E8F0; font-weight: 700; color: #0F172A;">
                <td style="padding: 10px 12px; border: 1px solid #CBD5E1;">TSI FLEET TOTAL</td>
                <td style="padding: 10px 12px; text-align: center; border: 1px solid #CBD5E1;">All TSI</td>
                <td style="padding: 10px 12px; text-align: center; color: #BE123C; border: 1px solid #CBD5E1;">{fleet_sums['90']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #B45309; border: 1px solid #CBD5E1;">{fleet_sums['30_90']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #1E40AF; border: 1px solid #CBD5E1;">{fleet_sums['0_30']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #1E3A8A; font-size: 13px; border: 1px solid #CBD5E1;">{fleet_sums['tot']}</td>
              </tr>
            </tfoot>
        """

    elif role_norm == "TA":
        html += """
            <thead>
              <tr style="background-color: #1E293B; color: #FFFFFF; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 10px 12px; text-align: left; border: 1px solid #CBD5E1;">Vessel Name</th>
                <th style="padding: 10px 12px; text-align: center; border: 1px solid #CBD5E1;">TA In-Charge</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #BE123C; border: 1px solid #CBD5E1;">90+ Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #B45309; border: 1px solid #CBD5E1;">30 to 90 Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #6D28D9; border: 1px solid #CBD5E1;">Below 30 Days</th>
                <th style="padding: 10px 12px; text-align: center; background-color: #581C87; border: 1px solid #CBD5E1;">TA Total</th>
              </tr>
            </thead>
            <tbody>
        """
        for idx, v_name in enumerate(active_vessels):
            _, ta_inc = _VESSEL_OWNERS.get(v_name, ("—", "—"))
            vc = vessel_counts[v_name]
            c_0_30 = vc["0_30_ta"]
            c_30_90 = vc["30_90_ta"]
            c_90 = vc["90_plus_ta"]
            c_tot = vc["tot_ta"]

            fleet_sums["0_30"] += c_0_30
            fleet_sums["30_90"] += c_30_90
            fleet_sums["90"] += c_90
            fleet_sums["tot"] += c_tot

            row_bg = "#FFFFFF" if idx % 2 == 0 else "#F8FAFC"
            html += f"""
              <tr style="background-color: {row_bg};">
                <td style="padding: 8px 12px; font-weight: 700; color: #0F172A; border: 1px solid #E2E8F0;">{v_name}</td>
                <td style="padding: 8px 12px; text-align: center; font-weight: 600; color: #6D28D9; border: 1px solid #E2E8F0;">{ta_inc}</td>
                <td style="padding: 8px 12px; text-align: center; color: #E11D48; font-weight: 600; border: 1px solid #E2E8F0;">{c_90 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; color: #D97706; font-weight: 600; border: 1px solid #E2E8F0;">{c_30_90 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; color: #6D28D9; font-weight: 600; border: 1px solid #E2E8F0;">{c_0_30 or "—"}</td>
                <td style="padding: 8px 12px; text-align: center; font-weight: 700; color: #581C87; border: 1px solid #E2E8F0;">{c_tot or "—"}</td>
              </tr>
            """
        html += f"""
            </tbody>
            <tfoot>
              <tr style="background-color: #E2E8F0; font-weight: 700; color: #0F172A;">
                <td style="padding: 10px 12px; border: 1px solid #CBD5E1;">TA FLEET TOTAL</td>
                <td style="padding: 10px 12px; text-align: center; border: 1px solid #CBD5E1;">All TA</td>
                <td style="padding: 10px 12px; text-align: center; color: #BE123C; border: 1px solid #CBD5E1;">{fleet_sums['90']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #B45309; border: 1px solid #CBD5E1;">{fleet_sums['30_90']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #6D28D9; border: 1px solid #CBD5E1;">{fleet_sums['0_30']}</td>
                <td style="padding: 10px 12px; text-align: center; color: #581C87; font-size: 13px; border: 1px solid #CBD5E1;">{fleet_sums['tot']}</td>
              </tr>
            </tfoot>
        """

    else:  # ALL
        html += """
            <thead>
              <tr style="background-color: #1E293B; color: #FFFFFF; font-size: 10.5px; text-transform: uppercase;">
                <th rowspan="2" style="padding: 8px 10px; text-align: left; border: 1px solid #CBD5E1;">Vessel Name</th>
                <th rowspan="2" style="padding: 8px 10px; text-align: center; border: 1px solid #CBD5E1;">TSI In-Charge</th>
                <th rowspan="2" style="padding: 8px 10px; text-align: center; border: 1px solid #CBD5E1;">TA In-Charge</th>
                <th colspan="3" style="padding: 6px 8px; text-align: center; background-color: #BE123C; border: 1px solid #CBD5E1;">90+ Days</th>
                <th colspan="3" style="padding: 6px 8px; text-align: center; background-color: #B45309; border: 1px solid #CBD5E1;">30 to 90 Days</th>
                <th colspan="3" style="padding: 6px 8px; text-align: center; background-color: #1E40AF; border: 1px solid #CBD5E1;">Below 30 Days</th>
                <th colspan="3" style="padding: 6px 8px; text-align: center; background-color: #0F2942; border: 1px solid #CBD5E1;">Total Pending</th>
              </tr>
              <tr style="background-color: #334155; color: #FFFFFF; font-size: 9.5px; text-transform: uppercase;">
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TSI</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TA</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">Tot</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TSI</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TA</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">Tot</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TSI</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TA</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">Tot</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TSI</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">TA</th>
                <th style="padding: 5px; text-align: center; border: 1px solid #CBD5E1;">Fleet</th>
              </tr>
            </thead>
            <tbody>
        """
        for idx, v_name in enumerate(active_vessels):
            tsi_inc, ta_inc = _VESSEL_OWNERS.get(v_name, ("—", "—"))
            vc = vessel_counts[v_name]

            c_0_30_tsi = vc["0_30_tsi"]
            c_0_30_ta = vc["0_30_ta"]
            c_0_30_tot = vc["0_30_tot"]

            c_30_90_tsi = vc["30_90_tsi"]
            c_30_90_ta = vc["30_90_ta"]
            c_30_90_tot = vc["30_90_tot"]

            c_90_tsi = vc["90_plus_tsi"]
            c_90_ta = vc["90_plus_ta"]
            c_90_tot = vc["90_plus_tot"]

            c_tot_tsi = vc["tot_tsi"]
            c_tot_ta = vc["tot_ta"]
            c_tot_all = vc["tot_all"]

            fleet_sums["0_30_tsi"] += c_0_30_tsi
            fleet_sums["0_30_ta"] += c_0_30_ta
            fleet_sums["0_30_tot"] += c_0_30_tot

            fleet_sums["30_90_tsi"] += c_30_90_tsi
            fleet_sums["30_90_ta"] += c_30_90_ta
            fleet_sums["30_90_tot"] += c_30_90_tot

            fleet_sums["90_tsi"] += c_90_tsi
            fleet_sums["90_ta"] += c_90_ta
            fleet_sums["90_tot"] += c_90_tot

            fleet_sums["tot_tsi"] += c_tot_tsi
            fleet_sums["tot_ta"] += c_tot_ta
            fleet_sums["tot_all"] += c_tot_all

            row_bg = "#FFFFFF" if idx % 2 == 0 else "#F8FAFC"
            html += f"""
              <tr style="background-color: {row_bg}; font-size: 11px;">
                <td style="padding: 7px 10px; font-weight: 700; color: #0F172A; border: 1px solid #E2E8F0;">{v_name}</td>
                <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #1E40AF; border: 1px solid #E2E8F0;">{tsi_inc}</td>
                <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #6D28D9; border: 1px solid #E2E8F0;">{ta_inc}</td>
                <td style="padding: 7px 5px; text-align: center; color: #E11D48; border: 1px solid #E2E8F0;">{c_90_tsi or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; color: #C026D3; border: 1px solid #E2E8F0;">{c_90_ta or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 700; color: #BE123C; border: 1px solid #E2E8F0;">{c_90_tot or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; color: #D97706; border: 1px solid #E2E8F0;">{c_30_90_tsi or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; color: #8B5CF6; border: 1px solid #E2E8F0;">{c_30_90_ta or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 700; color: #B45309; border: 1px solid #E2E8F0;">{c_30_90_tot or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; color: #2563EB; border: 1px solid #E2E8F0;">{c_0_30_tsi or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; color: #7C3AED; border: 1px solid #E2E8F0;">{c_0_30_ta or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 700; color: #1D4ED8; border: 1px solid #E2E8F0;">{c_0_30_tot or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 700; color: #1E3A8A; border: 1px solid #E2E8F0;">{c_tot_tsi or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 700; color: #581C87; border: 1px solid #E2E8F0;">{c_tot_ta or "—"}</td>
                <td style="padding: 7px 5px; text-align: center; font-weight: 800; color: #0F172A; background-color: #EEF2F6; border: 1px solid #E2E8F0;">{c_tot_all or "—"}</td>
              </tr>
            """
        html += f"""
            </tbody>
            <tfoot>
              <tr style="background-color: #E2E8F0; font-weight: 700; color: #0F172A; font-size: 11px;">
                <td style="padding: 8px 10px; border: 1px solid #CBD5E1;">FLEET TOTAL</td>
                <td style="padding: 8px 10px; text-align: center; border: 1px solid #CBD5E1;">All TSI</td>
                <td style="padding: 8px 10px; text-align: center; border: 1px solid #CBD5E1;">All TA</td>
                <td style="padding: 8px 5px; text-align: center; color: #E11D48; border: 1px solid #CBD5E1;">{fleet_sums['90_tsi']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #C026D3; border: 1px solid #CBD5E1;">{fleet_sums['90_ta']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #BE123C; font-weight: 800; border: 1px solid #CBD5E1;">{fleet_sums['90_tot']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #D97706; border: 1px solid #CBD5E1;">{fleet_sums['30_90_tsi']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #8B5CF6; border: 1px solid #CBD5E1;">{fleet_sums['30_90_ta']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #B45309; font-weight: 800; border: 1px solid #CBD5E1;">{fleet_sums['30_90_tot']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #2563EB; border: 1px solid #CBD5E1;">{fleet_sums['0_30_tsi']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #7C3AED; border: 1px solid #CBD5E1;">{fleet_sums['0_30_ta']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #1D4ED8; font-weight: 800; border: 1px solid #CBD5E1;">{fleet_sums['0_30_tot']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #1E3A8A; font-weight: 800; border: 1px solid #CBD5E1;">{fleet_sums['tot_tsi']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #581C87; font-weight: 800; border: 1px solid #CBD5E1;">{fleet_sums['tot_ta']}</td>
                <td style="padding: 8px 5px; text-align: center; color: #0F172A; font-size: 12px; font-weight: 800; background-color: #CBD5E1; border: 1px solid #94A3B8;">{fleet_sums['tot_all']}</td>
              </tr>
            </tfoot>
        """

    html += f"""
          </table>
        </div>

        <div style="margin: 0 20px 20px 20px; background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 14px 18px; font-size: 13px; color: #1E40AF;">
          <strong>Attachment Included:</strong> The complete detailed Excel report (<strong>{filename}</strong>) is attached to this email with all vessel-wise drill-down item records.
        </div>

        <div style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 14px 20px; font-size: 11px; color: #64748B; text-align: center;">
          Sent by PI Follow-up Tracker &bull; data@ozellar.com
        </div>
      </div>
    </body>
    </html>
    """
    return html


MANDATORY_TO_EMAILS = ["kunalchandra@ozellar.com", "Karunya.pius@ozellar.com"]
DEFAULT_CC_EMAILS = ["purchase@ozellar.com"]


@router.post("/preview-summary-email", response_model=PreviewPendingSummaryEmailResponse)
def preview_pending_items_summary_email(
    payload: SendPendingSummaryEmailRequest,
    db: Session = Depends(get_db),
) -> PreviewPendingSummaryEmailResponse:
    target_role = (payload.role or "ALL").strip().upper()
    if target_role not in ("ALL", "TSI", "TA"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be 'ALL', 'TSI', or 'TA'.",
        )

    items = _compute_pending_items(db)
    if payload.stage:
        stage_clean = payload.stage.strip()
        items = [i for i in items if (i.stage or "").upper() == stage_clean.upper()]
    else:
        stage_clean = None

    if stage_clean and target_role != "ALL":
        attachment_filename = f"{stage_clean.replace(' ', '_')}_{target_role}_Pending_Ageing.xlsx"
    elif stage_clean:
        attachment_filename = f"{stage_clean.replace(' ', '_')}_All_Pending_Ageing.xlsx"
    elif target_role != "ALL":
        attachment_filename = f"Fleet_{target_role}_Pending_Ageing.xlsx"
    else:
        attachment_filename = "Fleet_All_Pending_Ageing.xlsx"

    html_body = _build_pending_items_html_summary(
        items=items,
        role_label=target_role,
        filename=attachment_filename,
        stage_label=stage_clean,
    )

    if target_role == "TSI":
        target_users = db.query(User).filter(User.rank == "TSI", User.is_active.is_(True)).all()
    elif target_role == "TA":
        target_users = db.query(User).filter(User.rank == "TA", User.is_active.is_(True)).all()
    else:
        target_users = db.query(User).filter(User.rank.in_(["TSI", "TA"]), User.is_active.is_(True)).all()

    # Roster emails + mandatory TO recipients
    to_emails_set = {u.email.strip() for u in target_users if u.email and u.email.strip()}
    for m in MANDATORY_TO_EMAILS:
        to_emails_set.add(m.strip())
    default_to_emails = sorted(to_emails_set)
    default_cc_emails = list(DEFAULT_CC_EMAILS)

    date_str = datetime.now().strftime("%d %b %Y")
    if stage_clean:
        default_subject = f"{stage_clean} - {target_role} Pending Ageing Summary ({date_str})"
    else:
        default_subject = f"Fleet {target_role} Pending Ageing Summary ({date_str})"

    from_mailbox = "data@ozellar.com"

    return PreviewPendingSummaryEmailResponse(
        role=target_role,
        stage=stage_clean,
        subject=default_subject,
        from_mailbox=from_mailbox,
        default_to_emails=default_to_emails,
        default_cc_emails=default_cc_emails,
        attachment_filename=attachment_filename,
        items_count=len(items),
        html_body=html_body,
    )


@router.post("/send-summary-email", response_model=SendPendingSummaryEmailResponse)
def send_pending_items_summary_email(
    payload: SendPendingSummaryEmailRequest,
    db: Session = Depends(get_db),
) -> SendPendingSummaryEmailResponse:
    target_role = (payload.role or "ALL").strip().upper()
    if target_role not in ("ALL", "TSI", "TA"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role. Must be 'ALL', 'TSI', or 'TA'.",
        )

    items = _compute_pending_items(db)
    if payload.stage:
        stage_clean = payload.stage.strip()
        items = [i for i in items if (i.stage or "").upper() == stage_clean.upper()]
    else:
        stage_clean = None

    role_filter = [target_role] if target_role in ("TSI", "TA") else None
    stage_filter = [stage_clean] if stage_clean else None

    workbook = _build_pending_items_ageing_workbook(
        items=items,
        stage_filter=stage_filter,
        role_filter=role_filter,
    )

    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    attachment_bytes = buffer.getvalue()

    if stage_clean and target_role != "ALL":
        attachment_filename = f"{stage_clean.replace(' ', '_')}_{target_role}_Pending_Ageing.xlsx"
    elif stage_clean:
        attachment_filename = f"{stage_clean.replace(' ', '_')}_All_Pending_Ageing.xlsx"
    elif target_role != "ALL":
        attachment_filename = f"Fleet_{target_role}_Pending_Ageing.xlsx"
    else:
        attachment_filename = "Fleet_All_Pending_Ageing.xlsx"

    html_body = _build_pending_items_html_summary(
        items=items,
        role_label=target_role,
        filename=attachment_filename,
        stage_label=stage_clean,
    )

    # Determine recipients:
    # 1. If payload.test_email is passed, send to that single test email only
    # 2. If payload.to_emails is passed (e.g. user modified in UI modal), send to EXACTLY what was requested!
    # 3. Else fallback to querying DB users with corresponding rank + MANDATORY_TO_EMAILS (only if to_emails is None/empty)
    if payload.test_email and payload.test_email.strip():
        recipients = [payload.test_email.strip()]
        cc_recipients = []
    elif payload.to_emails is not None and len(payload.to_emails) > 0:
        recipients = sorted({e.strip() for e in payload.to_emails if e and e.strip()})
        cc_source = payload.cc_emails if payload.cc_emails is not None else []
        cc_recipients = sorted({e.strip() for e in cc_source if e and e.strip()})
    else:
        if target_role == "TSI":
            target_users = db.query(User).filter(User.rank == "TSI", User.is_active.is_(True)).all()
        elif target_role == "TA":
            target_users = db.query(User).filter(User.rank == "TA", User.is_active.is_(True)).all()
        else:
            target_users = db.query(User).filter(User.rank.in_(["TSI", "TA"]), User.is_active.is_(True)).all()
        to_set = {u.email.strip() for u in target_users if u.email and u.email.strip()}
        for m in MANDATORY_TO_EMAILS:
            to_set.add(m.strip())
        recipients = sorted(to_set)
        cc_source = payload.cc_emails if payload.cc_emails is not None else DEFAULT_CC_EMAILS
        cc_recipients = sorted({e.strip() for e in cc_source if e and e.strip()})

    if not recipients:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No active recipient emails provided or found for '{target_role}'.",
        )

    # Determine Subject
    date_str = datetime.now().strftime("%d %b %Y")
    if payload.subject and payload.subject.strip():
        subject = payload.subject.strip()
    elif stage_clean:
        subject = f"{stage_clean} - {target_role} Pending Ageing Summary ({date_str})"
    else:
        subject = f"Fleet {target_role} Pending Ageing Summary ({date_str})"

    from_mailbox = "data@ozellar.com"

    try:
        send_mail(
            to_emails=recipients,
            subject=subject,
            html_body=html_body,
            from_mailbox=from_mailbox,
            cc_emails=cc_recipients,
            attachments=[
                {
                    "name": attachment_filename,
                    "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "contentBytes": attachment_bytes,
                }
            ],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to send email: {e}",
        ) from e

    return SendPendingSummaryEmailResponse(
        sent=True,
        role=target_role,
        stage=stage_clean,
        recipients=recipients,
        cc_recipients=cc_recipients,
        subject=subject,
        from_mailbox=from_mailbox,
        attachment_filename=attachment_filename,
        items_count=len(items),
    )

