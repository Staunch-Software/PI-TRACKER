import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Query as OrmQuery
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.enums import UserRole
from app.db.session import get_db
from app.models.landing_report import LandingReport
from app.models.user import User
from app.models.vessel import Vessel
from app.schemas.common import PaginatedResult
from app.schemas.landing_report import (
    LandingReportCreate,
    LandingReportOut,
    LandingReportUpdate,
)
from app.services.landing_report_io import build_export_workbook

# Module-level gate (can_access_landing, Admin always passes) on every route; writes additionally
# need Admin/Editor, so Viewers are read-only.
router = APIRouter(
    prefix="/landing-reports",
    tags=["landing-reports"],
    dependencies=[Depends(require_module_access("landing"))],
)

_writers = require_roles(UserRole.ADMIN, UserRole.EDITOR)

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Frontend sort key -> column. Whitelisted so sort_by is never interpolated into the query.
_SORTABLE_COLUMNS = {
    "seqNo": LandingReport.seq_no,
    "vesselName": Vessel.name,
    "port": LandingReport.port,
    "oilType": LandingReport.oil_type,
    "offlandedDate": LandingReport.offlanded_date,
    "shipmentStatus": LandingReport.shipment_status,
    "reportStatus": LandingReport.report_status,
}


def _to_out(report: LandingReport, vessel_name: str) -> LandingReportOut:
    return LandingReportOut(
        id=report.id,
        seq_no=report.seq_no,
        vessel_id=report.vessel_id,
        vessel_name=vessel_name,
        port=report.port,
        oil_type=report.oil_type,
        offlanded_date=report.offlanded_date,
        shipment_status=report.shipment_status,
        report_status=report.report_status,
        created_at=report.created_at,
        updated_at=report.updated_at,
    )


def _require_vessel(db: Session, vessel_id: uuid.UUID) -> Vessel:
    # Any vessel is allowed, not just is_active ones — that flag only controls the PI dropdown
    # ("Show in PI dropdown" in Admin > Vessels).
    vessel = db.get(Vessel, vessel_id)
    if not vessel:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Vessel not found")
    return vessel


def _filtered_query(
    db: Session,
    search: str | None,
    vessel_id: list[uuid.UUID] | None,
    oil_type: list[str] | None,
    offlanded_date_from: date | None,
    offlanded_date_to: date | None,
    sort_by: str | None,
    sort_dir: str,
) -> OrmQuery:
    query = db.query(LandingReport, Vessel.name).join(Vessel, Vessel.id == LandingReport.vessel_id)

    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            or_(
                *[
                    column.ilike(pattern, escape="\\")
                    for column in (
                        cast(LandingReport.seq_no, String),
                        Vessel.name,
                        LandingReport.port,
                        LandingReport.oil_type,
                        cast(LandingReport.offlanded_date, String),
                        LandingReport.shipment_status,
                        LandingReport.report_status,
                    )
                ]
            )
        )
    if vessel_id:
        query = query.filter(LandingReport.vessel_id.in_(vessel_id))
    if oil_type:
        query = query.filter(LandingReport.oil_type.in_(oil_type))
    if offlanded_date_from:
        query = query.filter(LandingReport.offlanded_date >= offlanded_date_from)
    if offlanded_date_to:
        query = query.filter(LandingReport.offlanded_date <= offlanded_date_to)

    sort_column = _SORTABLE_COLUMNS.get(sort_by) if sort_by else None
    if sort_column is not None:
        ordered = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        return query.order_by(ordered.nulls_last(), LandingReport.seq_no.asc())
    return query.order_by(LandingReport.seq_no.asc())


@router.get("", response_model=PaginatedResult[LandingReportOut])
def list_landing_reports(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_id: list[uuid.UUID] | None = Query(default=None),
    oil_type: list[str] | None = Query(default=None),
    offlanded_date_from: date | None = Query(default=None),
    offlanded_date_to: date | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[LandingReportOut]:
    query = _filtered_query(
        db, search, vessel_id, oil_type, offlanded_date_from, offlanded_date_to, sort_by, sort_dir
    )
    total = query.order_by(None).count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResult[LandingReportOut](
        items=[_to_out(report, vessel_name) for report, vessel_name in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/export")
def export_landing_reports(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    vessel_id: list[uuid.UUID] | None = Query(default=None),
    oil_type: list[str] | None = Query(default=None),
    offlanded_date_from: date | None = Query(default=None),
    offlanded_date_to: date | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
) -> StreamingResponse:
    """Exports every row matching the current filters (no pagination) — same params as the list
    endpoint, so "export" always means "export exactly what's on screen right now"."""
    rows = _filtered_query(
        db, search, vessel_id, oil_type, offlanded_date_from, offlanded_date_to, sort_by, sort_dir
    ).all()
    filename = f"Landing_Reports_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        build_export_workbook(rows),
        media_type=_XLSX,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", response_model=LandingReportOut, status_code=status.HTTP_201_CREATED)
def create_landing_report(
    payload: LandingReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> LandingReportOut:
    vessel = _require_vessel(db, payload.vessel_id)
    report = LandingReport(
        vessel_id=payload.vessel_id,
        port=payload.port,
        oil_type=payload.oil_type.value,
        offlanded_date=payload.offlanded_date,
        shipment_status=payload.shipment_status,
        report_status=payload.report_status,
        created_by=current_user.id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)  # picks up the DB-generated seq_no
    return _to_out(report, vessel.name)


@router.patch("/{report_id}", response_model=LandingReportOut)
def update_landing_report(
    report_id: uuid.UUID,
    payload: LandingReportUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> LandingReportOut:
    report = db.get(LandingReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Landing report not found")

    updates = payload.model_dump(exclude_unset=True)
    # vessel_id and oil_type are NOT NULL — an explicit null means "no change".
    if updates.get("vessel_id") is None:
        updates.pop("vessel_id", None)
    elif updates["vessel_id"] != report.vessel_id:
        _require_vessel(db, updates["vessel_id"])
    if updates.get("oil_type") is None:
        updates.pop("oil_type", None)
    else:
        updates["oil_type"] = updates["oil_type"].value

    for field, value in updates.items():
        setattr(report, field, value)
    db.commit()
    db.refresh(report)
    vessel = db.get(Vessel, report.vessel_id)
    return _to_out(report, vessel.name)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_landing_report(
    report_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    report = db.get(LandingReport, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Landing report not found")
    db.delete(report)
    db.commit()
