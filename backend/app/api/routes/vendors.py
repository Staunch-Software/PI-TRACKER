import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor import Vendor
from app.schemas.lookup import LookupCreateRequest, VendorOut, VendorUpdateRequest
from app.services.audit import diff_fields, write_audit_log

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


@router.patch("/{vendor_id}", response_model=VendorOut)
def update_vendor(
    vendor_id: uuid.UUID,
    payload: VendorUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("name") and updates["name"] != vendor.name:
        if db.query(Vendor).filter(Vendor.name == updates["name"], Vendor.id != vendor_id).first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{updates['name']}' already exists")

    if updates:
        before = {field: getattr(vendor, field) for field in updates}
        for field, value in updates.items():
            setattr(vendor, field, value)

        changes = diff_fields(before, updates)
        if changes:
            write_audit_log(
                db,
                entity_type=AuditEntityType.VENDOR,
                entity_id=vendor.id,
                action=AuditAction.UPDATE,
                changed_by=current_user.id,
                summary=f"{current_user.full_name} updated vendor {vendor.name} ({', '.join(changes.keys())})",
                changes=changes,
            )

    db.commit()
    db.refresh(vendor)
    return vendor
