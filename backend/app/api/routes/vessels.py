import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vessel import Vessel
from app.schemas.lookup import VesselCreateRequest, VesselOut, VesselUpdateRequest
from app.services.audit import diff_fields, write_audit_log

router = APIRouter(prefix="/vessels", tags=["vessels"])


@router.get("", response_model=list[VesselOut])
def list_vessels(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    include_inactive: bool = Query(default=False),
) -> list[Vessel]:
    query = db.query(Vessel)
    if not include_inactive:
        query = query.filter(Vessel.is_active.is_(True))
    return query.order_by(Vessel.name).all()


@router.post("", response_model=VesselOut, status_code=status.HTTP_201_CREATED)
def create_vessel(
    payload: VesselCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> Vessel:
    existing = db.query(Vessel).filter(Vessel.name == payload.name).first()
    if existing:
        return existing

    vessel = Vessel(name=payload.name, imo_number=payload.imo_number, created_by=current_user.id)
    db.add(vessel)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.VESSEL,
        entity_id=vessel.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} added vessel {vessel.name}",
    )
    db.commit()
    db.refresh(vessel)
    return vessel


@router.patch("/{vessel_id}", response_model=VesselOut)
def update_vessel(
    vessel_id: uuid.UUID,
    payload: VesselUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> Vessel:
    vessel = db.get(Vessel, vessel_id)
    if not vessel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vessel not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("name") and updates["name"] != vessel.name:
        if db.query(Vessel).filter(Vessel.name == updates["name"], Vessel.id != vessel_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{updates['name']}' already exists")

    if updates:
        before = {field: getattr(vessel, field) for field in updates}
        for field, value in updates.items():
            setattr(vessel, field, value)

        changes = diff_fields(before, updates)
        if changes:
            write_audit_log(
                db,
                entity_type=AuditEntityType.VESSEL,
                entity_id=vessel.id,
                action=AuditAction.UPDATE,
                changed_by=current_user.id,
                summary=f"{current_user.full_name} updated vessel {vessel.name} ({', '.join(changes.keys())})",
                changes=changes,
            )

    db.commit()
    db.refresh(vessel)
    return vessel
