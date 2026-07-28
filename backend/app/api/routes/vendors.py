from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor import Vendor
from app.schemas.lookup import LookupCreateRequest, VendorOut
from app.services.audit import write_audit_log

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.get("", response_model=list[VendorOut])
def list_vendors(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    include_inactive: bool = Query(default=False),
) -> list[Vendor]:
    query = db.query(Vendor)
    if not include_inactive:
        query = query.filter(Vendor.is_active.is_(True))
    return query.order_by(Vendor.name).all()


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: LookupCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> Vendor:
    existing = db.query(Vendor).filter(Vendor.name == payload.name).first()
    if existing:
        return existing

    vendor = Vendor(name=payload.name, created_by=current_user.id)
    db.add(vendor)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.VENDOR,
        entity_id=vendor.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} added vendor {vendor.name}",
    )
    db.commit()
    db.refresh(vendor)
    return vendor
