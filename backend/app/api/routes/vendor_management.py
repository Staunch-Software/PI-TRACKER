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
    VendorBankRequestPreview,
    VendorBankRequestSend,
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

# The 6 fields SmartPAL's own Bank Details tab is checked against (same set the purchaser manually
# re-keys into the Verified Bank Fields column) — (VendorBankDetail attribute, display label).
_BANK_MANDATORY_FIELDS: list[tuple[str, str]] = [
    ("beneficiary_name", "Beneficiary Name"),
    ("bank_name", "Bank Name"),
    ("branch_name", "Branch Name"),
    ("account_number", "Account Number"),
    ("iban", "IBAN"),
    ("swift_code", "Swift Code"),
]

# Fixed, short allowlist for the "Send Bank Details Request" preview modal's From dropdown —
# validated server-side so a client can't send as an arbitrary mailbox (Mail.Send is an
# application-wide Graph permission, see pi_reminder_mailer.py).
BANK_REQUEST_SENDERS: dict[str, str] = {
    "jayasri.v@ozellar.com": "Jayasri Viswanathan",
    "gayathri.p@ozellar.com": "Gayathri Sarvanan",
}


def _actor_name(db: Session, user_id: uuid.UUID | None) -> str | None:
    if not user_id:
        return None
    user = db.get(User, user_id)
    return user.full_name if user else None


def _bank_rep_row(db: Session, vendor_code: str) -> tuple[VendorBankDetail | None, int]:
    """The vendor's representative SmartPAL bank row (the one marked Default, else the first) plus
    the total row count — used both for display (bank_details_count) and for the PAL-completeness
    gate (_pal_bank_completeness)."""
    rows = db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code == vendor_code).all()
    if not rows:
        return None, 0
    rep = next((r for r in rows if r.is_default), rows[0])
    return rep, len(rows)


def _pal_bank_completeness(bank_row: VendorBankDetail | None) -> tuple[bool, list[str]]:
    if not bank_row:
        return False, [label for _, label in _BANK_MANDATORY_FIELDS]
    missing = [label for attr, label in _BANK_MANDATORY_FIELDS if not getattr(bank_row, attr)]
    return len(missing) == 0, missing


def _to_out(
    entry: VendorTrackerEntry,
    master: VendorMasterEntry | None,
    bank_row: VendorBankDetail | None,
    bank_count: int,
    db: Session,
) -> VendorTrackerEntryOut:
    has_mandatory = bool(master and master.email and master.address and master.phone_1)
    pal_complete, pal_missing = _pal_bank_completeness(bank_row)
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
        bank_details_in_pal_complete=pal_complete,
        bank_details_in_pal_missing_fields=pal_missing,
    )


def _attach_live_data(db: Session, entries: list[VendorTrackerEntry]) -> list[VendorTrackerEntryOut]:
    vendor_codes = {e.vendor_code for e in entries}
    masters = {
        m.vendor_code: m for m in db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code.in_(vendor_codes)).all()
    } if vendor_codes else {}

    bank_rows_by_vendor: dict[str, list[VendorBankDetail]] = {}
    if vendor_codes:
        for row in db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code.in_(vendor_codes)).all():
            bank_rows_by_vendor.setdefault(row.vendor_code, []).append(row)

    def rep_and_count(code: str) -> tuple[VendorBankDetail | None, int]:
        rows = bank_rows_by_vendor.get(code, [])
        if not rows:
            return None, 0
        return next((r for r in rows if r.is_default), rows[0]), len(rows)

    out = []
    for e in entries:
        rep, count = rep_and_count(e.vendor_code)
        out.append(_to_out(e, masters.get(e.vendor_code), rep, count, db))
    return out


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

    bank_row, bank_count = _bank_rep_row(db, payload.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


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
    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


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

    # Normally gated on having gone through the request/receive workflow — but when SmartPAL
    # already has the vendor's bank details on file, there's nothing to request, so keying in the
    # verified fields is allowed straight away (see Verified Bank Fields column: the Send
    # Request/Mark Received buttons only appear when PAL has none).
    bank_row, _ = _bank_rep_row(db, entry.vendor_code)
    pal_complete, _ = _pal_bank_completeness(bank_row)
    if entry.bank_details_status not in (BankDetailsStatus.RECEIVED.value, BankDetailsStatus.UPDATED.value) and not pal_complete:
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
    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


@router.get("/{entry_id}/bank-request-preview", response_model=VendorBankRequestPreview)
def get_bank_request_preview(entry_id: uuid.UUID, db: Session = Depends(get_db)) -> VendorBankRequestPreview:
    """Drafted subject/body for the "Send Bank Details Request" preview modal — the user can edit
    both before actually sending (see send_bank_request)."""
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
    return VendorBankRequestPreview(to_email=master.email, subject=subject, body=body)


@router.post("/{entry_id}/send-bank-request", response_model=VendorTrackerEntryOut)
def send_bank_request(
    entry_id: uuid.UUID,
    payload: VendorBankRequestSend,
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

    from_mailbox = payload.from_mailbox.strip().lower()
    sender_name = BANK_REQUEST_SENDERS.get(from_mailbox)
    if not sender_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown sender mailbox.")

    try:
        send_mail([master.email], payload.subject, payload.body, from_mailbox=from_mailbox)
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
        summary=f"{current_user.full_name} sent a bank details request to {master.vendor_name or entry.vendor_code} ({master.email}) from {sender_name}",
    )
    db.commit()
    db.refresh(entry)

    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


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
    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


@router.post("/{entry_id}/mark-verification-completed", response_model=VendorTrackerEntryOut)
def mark_verification_completed(
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    # Gated on SmartPAL's OWN bank row having all 6 mandatory fields — not on our manually-keyed
    # Verified Bank Fields — per the Bank Verification column's design: it's confirming what's on
    # file in PAL, so it can't be enabled until PAL itself is complete.
    bank_row, _ = _bank_rep_row(db, entry.vendor_code)
    pal_complete, pal_missing = _pal_bank_completeness(bank_row)
    if not pal_complete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"All mandatory bank fields must be present in SmartPAL first (missing: {', '.join(pal_missing)}).",
        )

    entry.bank_verification_completed = True
    entry.bank_verification_completed_at = datetime.now()
    entry.bank_verification_completed_by = current_user.id
    entry.updated_by = current_user.id
    db.commit()
    db.refresh(entry)

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


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
