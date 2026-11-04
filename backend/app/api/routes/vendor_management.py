import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import require_module_access, require_roles
from app.core.enums import AuditAction, AuditEntityType, BankDetailsStatus, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor_bank_attachment import VendorBankAttachment
from app.models.vendor_bank_detail import VendorBankDetail
from app.models.vendor_detail_bulk_scrape_run import VendorDetailBulkScrapeRun
from app.models.vendor_master_entry import VendorMasterEntry
from app.models.vendor_tracker_entry import VendorTrackerEntry
from app.schemas.common import PaginatedResult
from app.schemas.vendor_management import (
    VendorBankDetailOut,
    VendorBankRequestPreview,
    VendorBankRequestSend,
    VendorDetailBulkScrapeRunOut,
    VendorMasterLookupResult,
    VendorTrackerEntryCreate,
    VendorTrackerEntryDetailOut,
    VendorTrackerEntryOut,
    VendorVerificationReminderPreview,
    VendorVerificationReminderSend,
)
from app.services.audit import write_audit_log
from app.services.pi_reminder_mailer import ALWAYS_CC, send_mail
from app.services.pi_reminder_templates import bank_details_request_email, verification_reminder_email
from app.services.vendor_master_scraper.detail_scraper import run_bulk_detail_scrape, scrape_vendor_detail

VERIFICATION_REMINDER_DEFAULT_TO = "accountspayable@ozellar.com"

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

# Added 2026-11-04 (confirmed with the user): both vendor-bank mail drafts should default-CC this
# address, on top of send_mail's own ALWAYS_CC — these are editable defaults, not enforced, so the
# user can still remove it in the modal before sending.
VENDOR_MANAGEMENT_DEFAULT_CC = "vrm@ozellar.com"


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
    entry: VendorTrackerEntry | None,
    master: VendorMasterEntry | None,
    bank_row: VendorBankDetail | None,
    bank_count: int,
    db: Session,
) -> VendorTrackerEntryOut:
    """entry is None for an "All Vendors" row with no vendor_tracker_entries row yet — every
    tracker-owned field below falls back to its untracked default in that case (see
    VendorTrackerEntryOut's nullable id/seq_no/created_at/updated_at). See
    /vendor-management/by-vendor-code/{vendor_code}/ensure-tracking for how such a row becomes
    real on first user action."""
    has_mandatory = bool(master and master.email and master.address and master.phone_1)
    pal_complete, pal_missing = _pal_bank_completeness(bank_row)
    return VendorTrackerEntryOut(
        id=entry.id if entry else None,
        seq_no=entry.seq_no if entry else None,
        vendor_code=entry.vendor_code if entry else (master.vendor_code if master else ""),
        is_dd_vendor=entry.is_dd_vendor if entry else False,
        bank_details_status=entry.bank_details_status if entry else BankDetailsStatus.MISSING.value,
        bank_request_sent_at=entry.bank_request_sent_at if entry else None,
        bank_request_sent_by_name=_actor_name(db, entry.bank_request_sent_by) if entry else None,
        bank_details_received_at=entry.bank_details_received_at if entry else None,
        bank_details_received_by_name=_actor_name(db, entry.bank_details_received_by) if entry else None,
        bank_details_updated_at=entry.bank_details_updated_at if entry else None,
        bank_details_updated_by_name=_actor_name(db, entry.bank_details_updated_by) if entry else None,
        bank_beneficiary_name=entry.bank_beneficiary_name if entry else None,
        bank_name=entry.bank_name if entry else None,
        bank_branch_name=entry.bank_branch_name if entry else None,
        bank_account_number=entry.bank_account_number if entry else None,
        bank_iban=entry.bank_iban if entry else None,
        bank_swift_code=entry.bank_swift_code if entry else None,
        bank_verification_completed=entry.bank_verification_completed if entry else False,
        bank_verification_completed_by_name=_actor_name(db, entry.bank_verification_completed_by) if entry else None,
        bank_verification_completed_at=entry.bank_verification_completed_at if entry else None,
        created_at=entry.created_at if entry else None,
        updated_at=entry.updated_at if entry else None,
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


def _get_or_create_tracker_entry(
    db: Session, vendor_code: str, current_user: User
) -> tuple[VendorTrackerEntry, bool]:
    """Returns (entry, was_created). Used by both the idempotent "+ Add DD Vendor" POST and the
    "All Vendors" tab's ensure-tracking endpoint — the only difference between those two call
    sites is whether is_dd_vendor gets flipped True afterward, not whether/how the row itself gets
    created."""
    entry = db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code == vendor_code).first()
    if entry:
        return entry, False
    entry = VendorTrackerEntry(vendor_code=vendor_code, created_by=current_user.id, updated_by=current_user.id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry, True


def _bank_rep_map(db: Session, vendor_codes: set[str]) -> dict[str, tuple[VendorBankDetail | None, int]]:
    """vendor_code -> (representative bank row, total row count), batch-loaded for a page of
    vendor_codes at once — shared by the DD-only list, the All Vendors list, and anywhere else that
    needs this for more than one vendor at a time."""
    if not vendor_codes:
        return {}
    bank_rows_by_vendor: dict[str, list[VendorBankDetail]] = {}
    for row in db.query(VendorBankDetail).filter(VendorBankDetail.vendor_code.in_(vendor_codes)).all():
        bank_rows_by_vendor.setdefault(row.vendor_code, []).append(row)
    result: dict[str, tuple[VendorBankDetail | None, int]] = {}
    for code, rows in bank_rows_by_vendor.items():
        result[code] = (next((r for r in rows if r.is_default), rows[0]), len(rows))
    return result


def _attach_live_data(db: Session, entries: list[VendorTrackerEntry]) -> list[VendorTrackerEntryOut]:
    vendor_codes = {e.vendor_code for e in entries}
    masters = {
        m.vendor_code: m for m in db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code.in_(vendor_codes)).all()
    } if vendor_codes else {}
    bank_reps = _bank_rep_map(db, vendor_codes)

    out = []
    for e in entries:
        rep, count = bank_reps.get(e.vendor_code, (None, 0))
        out.append(_to_out(e, masters.get(e.vendor_code), rep, count, db))
    return out


@router.get("", response_model=PaginatedResult[VendorTrackerEntryOut])
def list_vendor_tracker_entries(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[VendorTrackerEntryOut]:
    query = db.query(VendorTrackerEntry).filter(VendorTrackerEntry.is_dd_vendor.is_(True))
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(VendorTrackerEntry.vendor_code.ilike(pattern, escape="\\"))
    query = query.order_by(VendorTrackerEntry.seq_no.asc())

    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResult[VendorTrackerEntryOut](items=_attach_live_data(db, rows), total=total, page=page, page_size=page_size)


@router.get("/all", response_model=PaginatedResult[VendorTrackerEntryOut])
def list_all_vendors(
    db: Session = Depends(get_db),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=1000),
) -> PaginatedResult[VendorTrackerEntryOut]:
    """Every vendor in the SmartPAL master, LEFT-joined to its vendor_tracker_entries row if one
    exists — the "All Vendors" tab. Rows without a tracker entry yet come back with id=None; every
    row action on the frontend calls ensure-tracking first to materialize one on demand (see
    VendorManagementTable.tsx). Driven by VendorMasterEntry, not VendorTrackerEntry, since the
    whole point of this tab is to show vendors that AREN'T tracked yet too."""
    query = db.query(VendorMasterEntry)
    if search and search.strip():
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        query = query.filter(
            (VendorMasterEntry.vendor_code.ilike(pattern, escape="\\"))
            | (VendorMasterEntry.vendor_name.ilike(pattern, escape="\\"))
        )
    query = query.order_by(VendorMasterEntry.vendor_name.asc())

    total = query.count()
    masters = query.offset((page - 1) * page_size).limit(page_size).all()
    vendor_codes = {m.vendor_code for m in masters}

    tracker_entries = {
        e.vendor_code: e
        for e in db.query(VendorTrackerEntry).filter(VendorTrackerEntry.vendor_code.in_(vendor_codes)).all()
    } if vendor_codes else {}
    bank_reps = _bank_rep_map(db, vendor_codes)

    items = []
    for m in masters:
        rep, count = bank_reps.get(m.vendor_code, (None, 0))
        items.append(_to_out(tracker_entries.get(m.vendor_code), m, rep, count, db))
    return PaginatedResult[VendorTrackerEntryOut](items=items, total=total, page=page, page_size=page_size)


@router.post("/by-vendor-code/{vendor_code}/ensure-tracking", response_model=VendorTrackerEntryOut)
def ensure_vendor_tracking(
    vendor_code: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    """Get-or-create the vendor_tracker_entries row for vendor_code, WITHOUT changing is_dd_vendor
    — called by every row action on an id-less "All Vendors" tab row before the actual action, so
    it has a real id to act on. Defaults is_dd_vendor=False; only "+ Add DD Vendor" (create_
    vendor_tracker_entry, below) ever sets it True."""
    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == vendor_code).first()
    if not master:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found in SmartPAL vendor master")

    entry, was_created = _get_or_create_tracker_entry(db, vendor_code, current_user)
    if was_created:
        # See refresh_vendor_tracker_entry below for why this is cleared before scheduling.
        master.detail_scraped_at = None
        db.commit()
        background_tasks.add_task(scrape_vendor_detail, vendor_code)

    bank_row, bank_count = _bank_rep_row(db, vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


def _latest_bulk_scrape_run(db: Session) -> VendorDetailBulkScrapeRun | None:
    return db.query(VendorDetailBulkScrapeRun).order_by(VendorDetailBulkScrapeRun.started_at.desc()).first()


def _bulk_scrape_run_out(db: Session, run: VendorDetailBulkScrapeRun) -> VendorDetailBulkScrapeRunOut:
    return VendorDetailBulkScrapeRunOut(
        id=run.id,
        status=run.status,
        total=run.total,
        completed=run.completed,
        succeeded=run.succeeded,
        failed=run.failed,
        current_vendor_code=run.current_vendor_code,
        started_at=run.started_at,
        started_by_name=_actor_name(db, run.started_by),
        finished_at=run.finished_at,
    )


@router.get("/all/bulk-refresh/status", response_model=VendorDetailBulkScrapeRunOut | None)
def get_bulk_scrape_status(db: Session = Depends(get_db)) -> VendorDetailBulkScrapeRunOut | None:
    """Most recent "Scrape All Vendor Details" run (All Vendors tab), or None if one's never been
    started — polled by the frontend while a run is in progress."""
    run = _latest_bulk_scrape_run(db)
    return _bulk_scrape_run_out(db, run) if run else None


@router.post("/all/bulk-refresh", response_model=VendorDetailBulkScrapeRunOut)
def start_bulk_scrape(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorDetailBulkScrapeRunOut:
    """Starts a background job detail-scraping every vendor that's never been detail-scraped yet
    (see run_bulk_detail_scrape) — one at a time, realistically 1-3+ hours for the fleet's first
    run. 409s if one's already running rather than letting two pile up (SmartPAL only tolerates one
    logged-in session at a time for this scraper)."""
    existing = _latest_bulk_scrape_run(db)
    if existing and existing.status == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A bulk scrape is already running.")

    total = db.query(VendorMasterEntry).filter(VendorMasterEntry.detail_scraped_at.is_(None)).count()
    run = VendorDetailBulkScrapeRun(
        status="completed" if total == 0 else "running",
        total=total,
        started_by=current_user.id,
        finished_at=datetime.now() if total == 0 else None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    if total > 0:
        background_tasks.add_task(run_bulk_detail_scrape, run.id)

    return _bulk_scrape_run_out(db, run)


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

    # Idempotent "+ Add DD Vendor": a row may already exist with is_dd_vendor=False (lazily created
    # by an action taken on this vendor from the All Vendors tab, see ensure_vendor_tracking above)
    # — promote it instead of 409ing, since from the user's perspective they're just now
    # classifying an already-tracked vendor as DD, not creating a duplicate.
    entry, was_created = _get_or_create_tracker_entry(db, payload.vendor_code, current_user)
    if not entry.is_dd_vendor:
        entry.is_dd_vendor = True
        entry.updated_by = current_user.id
        db.commit()
        db.refresh(entry)

    if was_created:
        # See refresh_vendor_tracker_entry below for why this is cleared before scheduling.
        master.detail_scraped_at = None
        db.commit()
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

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    # Clear BEFORE scheduling the background scrape (not after it finishes) — detail_scrape_pending
    # is computed as `not master.detail_scraped_at`, so clearing it here is what makes the
    # response below (and the frontend's refetchInterval polling, which only re-engages while any
    # row is pending) immediately reflect "refreshing" instead of silently showing stale data until
    # a manual page reload. Fixed 2026-11-04 — see plan.
    if master:
        master.detail_scraped_at = None
        db.commit()

    background_tasks.add_task(scrape_vendor_detail, entry.vendor_code)

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

    bank_row, _ = _bank_rep_row(db, entry.vendor_code)
    _, pal_missing = _pal_bank_completeness(bank_row)
    subject, body = bank_details_request_email(vendor_name=master.vendor_name or entry.vendor_code, missing_fields=pal_missing)
    return VendorBankRequestPreview(to_email=master.email, cc_emails=[*ALWAYS_CC, VENDOR_MANAGEMENT_DEFAULT_CC], subject=subject, body=body)


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
    if not master:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This vendor was not found in SmartPAL.")

    from_mailbox = payload.from_mailbox.strip().lower()
    sender_name = BANK_REQUEST_SENDERS.get(from_mailbox)
    if not sender_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown sender mailbox.")

    try:
        send_mail(payload.to, payload.subject, payload.body, from_mailbox=from_mailbox, cc_emails=payload.cc)
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
        summary=f"{current_user.full_name} sent a bank details request to {master.vendor_name or entry.vendor_code} ({', '.join(payload.to)}) from {sender_name}",
    )
    db.commit()
    db.refresh(entry)

    bank_row, bank_count = _bank_rep_row(db, entry.vendor_code)
    return _to_out(entry, master, bank_row, bank_count, db)


@router.get("/{entry_id}/verification-reminder-preview", response_model=VendorVerificationReminderPreview)
def get_verification_reminder_preview(entry_id: uuid.UUID, db: Session = Depends(get_db)) -> VendorVerificationReminderPreview:
    """Drafted subject/body for the "Send Verification Reminder" preview modal. Only meaningful
    once SmartPAL's bank row is complete — matches the frontend's disabled-button gate, enforced
    again here since this is also where the recipient/body actually get built."""
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_row, _ = _bank_rep_row(db, entry.vendor_code)
    pal_complete, pal_missing = _pal_bank_completeness(bank_row)
    if not pal_complete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"All mandatory bank fields must be present in SmartPAL first (missing: {', '.join(pal_missing)}).",
        )

    subject, body = verification_reminder_email(
        vendor_name=master.vendor_name if master else entry.vendor_code,
        bank_row=bank_row,
        vendor_email=master.email if master else None,
        vendor_phone=master.phone_1 if master else None,
        vendor_address=master.address if master else None,
    )
    return VendorVerificationReminderPreview(
        to_email=VERIFICATION_REMINDER_DEFAULT_TO, cc_emails=[VENDOR_MANAGEMENT_DEFAULT_CC], subject=subject, body=body
    )


@router.post("/{entry_id}/send-verification-reminder", response_model=VendorTrackerEntryOut)
def send_verification_reminder(
    entry_id: uuid.UUID,
    payload: VendorVerificationReminderSend,
    db: Session = Depends(get_db),
    current_user: User = Depends(_writers),
) -> VendorTrackerEntryOut:
    entry = db.get(VendorTrackerEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor tracker entry not found")

    master = db.query(VendorMasterEntry).filter(VendorMasterEntry.vendor_code == entry.vendor_code).first()
    bank_row, _ = _bank_rep_row(db, entry.vendor_code)
    pal_complete, pal_missing = _pal_bank_completeness(bank_row)
    if not pal_complete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"All mandatory bank fields must be present in SmartPAL first (missing: {', '.join(pal_missing)}).",
        )

    try:
        send_mail(payload.to, payload.subject, payload.body, cc_emails=payload.cc)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Failed to send email: {e}") from e

    write_audit_log(
        db,
        entity_type=AuditEntityType.VENDOR_TRACKER_ENTRY,
        entity_id=entry.id,
        action=AuditAction.SENT_VERIFICATION_REMINDER,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} sent a bank verification reminder for {master.vendor_name if master else entry.vendor_code} to {', '.join(payload.to)}",
    )
    db.commit()
    db.refresh(entry)

    bank_count = _bank_rep_row(db, entry.vendor_code)[1]
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

    # Mandatory supporting attachment (confirmed 2026-11-04) — the frontend's
    # VendorVerificationCompleteModal requires picking a file before it will even call this
    # endpoint, but this check is the real enforcement: it holds even if something else ever calls
    # this endpoint directly.
    attachment_count = (
        db.query(VendorBankAttachment).filter(VendorBankAttachment.vendor_tracker_entry_id == entry.id).count()
    )
    if attachment_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Upload a bank attachment before marking verification complete.",
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
