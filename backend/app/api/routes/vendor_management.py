import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.enums import AuditAction, AuditEntityType, BankDetailsStatus, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor_bank_detail import VendorBankDetail
from app.models.vendor_master_entry import VendorMasterEntry
from app.models.vendor_tracker_entry import VendorTrackerEntry
from app.schemas.common import PaginatedResult
from app.schemas.vendor_management import (
    VendorBankDetailOut,
    VendorMasterLookupResult,
    VendorTrackerEntryBankUpdate,
    VendorTrackerEntryCreate,
    VendorTrackerEntryDetailOut,
    VendorTrackerEntryOut,
)
from app.services.audit import write_audit_log
from app.services.pi_reminder_mailer import send_mail
from app.services.pi_reminder_templates import bank_details_request_email
from app.services.vendor_master_scraper.detail_scraper import scrape_vendor_detail

# Module-level gate (can_access_vendor, Admin always passes) on every route; writes additionally
# need Admin/Editor, same stance as every other module in this app.
router = APIRouter(
    prefix="/vendor-management",
    tags=["vendor-management"],
    dependencies=[Depends(require_module_access("vendor"))],
)

_writers = require_roles(UserRole.ADMIN, UserRole.EDITOR)


def _actor_name(db: Session, user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None
    user = db.get(User, user_id)
    return user.full_name if user else None


def _to_out(entry: VendorTrackerEntry, master: VendorMasterEntry | None, bank_count: int, db: Session) -> VendorTrackerEntryOut:
    has_mandatory = bool(master and master.email and master.address and master.phone_1)
    return VendorTrackerEntryOut(
        id=entry.id,
        seq_no=entry.seq_no,
        vendor_code=entry.vendor_code,
        bank_details_status=entry.bank_details_status,
        bank_request_sent_at=entry.bank_request_sent_at,
        bank_request_sent_by_name=_actor_name(db, entry.bank_request_sent_by),
        bank_details_received_at=entry.bank_details_received_at,
        bank_details_received_by_name=_actor_name(db, entry.bank_details_received_by),
        bank_details_updated_at=entry.bank_details_updated_at,
        bank_details_updated_by_name=_actor_name(db, entry.bank_details_updated_by),
        bank_beneficiary_name=entry.bank_beneficiary_name,
        bank_name=entry.bank_name,
        bank_branch_name=entry.bank_branch_name,
        bank_account_number=entry.bank_account_number,
        bank_iban=entry.bank_iban,
        bank_swift_code=entry.bank_swift_code,
        bank_verification_completed=entry.bank_verification_completed,
        bank_verification_completed_by_name=_actor_name(db, entry.bank_verification_completed_by),
        bank_verification_completed_at=entry.bank_verification_completed_at,
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        vendor_name=master.vendor_name if master else None,
        vendor_type=master.vendor_type if master else None,
        vendor_email=master.email if master else None,
        vendor_phone_1=master.phone_1 if master else None,
        vendor_address=master.address if master else None,
        vendor_city=master.city if master else None,
        vendor_country=master.country if master else None,
        vendor_state=master.state if master else None,
        detail_scrape_pending=not (master and master.detail_scraped_at),
        has_mandatory_details=has_mandatory,
        bank_details_count=bank_count,
    )


def _attach_live_data(db: Session, entries: list[VendorTrackerEntry]) -> list[VendorTrackerEntryOut]:
    vendor_codes = {e.vendor_code for e in entries}
    masters = {
        m.vendor_code: m for m in db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code.in_(vendor_codes)).all()
    } if vendor_codes else {}

    bank_counts: dict[str, int] = {}
    if vendor_codes:
        rows = db.query(VendorBankDetail.vendor_code).filter(VendorBankDetail.vendor_code.in_(vendor_codes)).all()
        for (code,) in rows:
            bank_counts[code] = bank_counts.get(code, 0) + 1

    return [_to_out(e, masters.get(e.vendor_code), bank_counts.get(e.vendor_code, 0), db) for e in entries]


@router.get("", response_model=PaginatedResult[VendorTrackerEntryOut])
def list_vendor_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[VendorTrackerEntryOut]:
    query = db.query(VendorTrackerEntry)
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(VendorTrackerEntry.vendor_code.ilike(pattern, escape="\\"))
    query = query.order_by(VendorTrackerEntry.seq_no.asc())

    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResult[VendorTrackerEntryOut](items=_attach_live_data(db, rows), total=total, page=page, page_size=page_size)


@router.get("/vendor-options", response_model=list[VendorMasterLookupResult])
def list_vendor_options(db: Session = Depends(get_db)) -> list[VendorMasterLookupResult]:
    """Full vendor-master list for the "Add DD Vendor" picker — fetched once and filtered
    client-side (see frontend/src/components/vendormanagement/VendorManagementPage.tsx), since
    ~1,098 short rows is trivial to substring-filter in the browser and SearchableSelect has no
    live-backend-search support today."""
    rows = db.query(VendorMasterEntry).order_by(VendorMasterEntry.vendor_name.asc()).all()
    return [
        VendorMasterLookupResult(
            vendor_code=r.vendor_code, vendor_name=r.vendor_name, vendor_type=r.vendor_type,
            email=r.email, currency=r.currency, city=r.city, country=r.country, state=r.state,
        )
        for r in rows
    ]


@router.get("/{entry_id}/detail", response_model=VendorTrackerEntryDetailOut)
def get_vendor_tracker_entry_detail(entry_id: uuid.UUID, db: Session = Depends(get_db)) -> VendorTrackerEntryDetailOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_rows = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).all()
    return VendorTrackerEntryDetailOut(
        contacts=(master.contacts if master else []) or [],
        bank_details=[VendorBankDetailOut.model_validate(r) for r in bank_rows],
    )


@router.post("", response_model=VendorTrackerEntryOut, status_code=status.HTTP_201_CREATED)
def create_vendor_tracker_entry(
    payload: VendorTrackerEntryCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == payload.vendor_code).first()
    if not master:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found in SmartPAL vendor master")

    existing = db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code == payload.vendor_code).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This vendor is already being tracked")

    entry = VendorTrackerEntry(vendor_code=payload.vendor_code, created_by=current_user.id, updated_by=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)

    background_tasks.add_task(scrape_vendor_detail, payload.vendor_code)

    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == payload.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.post("/{entry_id}/refresh", response_model=VendorTrackerEntryOut)
def refresh_vendor_tracker_entry(
    entry_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    background_tasks.add_task(scrape_vendor_detail, entry.vendor_code)

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.patch("/{entry_id}/bank-details", response_model=VendorTrackerEntryOut)
def update_bank_details(
    entry_id: uuid.UUID,
    payload: VendorTrackerEntryBankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")
    if entry.bank_details_status not in (BankDetailsStatus.RECEIVED.value, BankDetailsStatus.UPDATED.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mark the vendor's bank details as received before keying them in.",
        )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    entry.bank_details_status = BankDetailsStatus.UPDATED.value
    entry.bank_details_updated_at = datetime.now()
    entry.bank_details_updated_by = current_user.id
    entry.updated_by = current_user.id
    db.commit()
    db.refresh(entry)

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.post("/{entry_id}/send-bank-request", response_model=VendorTrackerEntryOut)
def send_bank_request(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    if not master or not master.email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This vendor has no email address on file in SmartPAL.",
        )

    subject, body = bank_details_request_email(vendor_name=master.vendor_name or entry.vendor_code)
    try:
        send_mail([master.email], subject, body)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to send email: {e}") from e

    if entry.bank_details_status == BankDetailsStatus.MISSING.value:
        entry.bank_details_status = BankDetailsStatus.REQUESTED.value
    entry.bank_request_sent_at = datetime.now()
    entry.bank_request_sent_by = current_user.id
    entry.updated_by = current_user.id

    write_audit_log(
        db,
        entity_type=AuditEntityType.VENDOR_TRACKER_ENTRY,
        entity_id=entry.id,
        action=AuditAction.SENT_BANK_REQUEST,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} sent a bank details request to {master.vendor_name or entry.vendor_code} ({master.email})",
    )
    db.commit()
    db.refresh(entry)

    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.post("/{entry_id}/mark-bank-received", response_model=VendorTrackerEntryOut)
def mark_bank_received(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    entry.bank_details_status = BankDetailsStatus.RECEIVED.value
    entry.bank_details_received_at = datetime.now()
    entry.bank_details_received_by = current_user.id
    entry.updated_by = current_user.id
    db.commit()
    db.refresh(entry)

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.post("/{entry_id}/mark-verification-completed", response_model=VendorTrackerEntryOut)
def mark_verification_completed(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")
    if entry.bank_details_status != BankDetailsStatus.UPDATED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bank details must be keyed in (status: Updated) before verification can be marked complete.",
        )

    entry.bank_verification_completed = True
    entry.bank_verification_completed_at = datetime.now()
    entry.bank_verification_completed_by = current_user.id
    entry.updated_by = current_user.id
    db.commit()
    db.refresh(entry)

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_count = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == entry.vendor_code).count()
    return _to_out(entry, master, bank_count, db)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor_tracker_entry(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(_writers),
) -> None:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")
    db.delete(entry)
    db.commit()
