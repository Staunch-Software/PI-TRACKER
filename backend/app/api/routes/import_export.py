import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.enums import AuditAction, AuditEntityType, UserRole
from app.db.session import get_db
from app.models.pi_entry import PiEntry
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vessel import Vessel
from app.schemas.import_wizard import ImportCommitRequest, ImportCommitResponse, ImportParseResponse
from app.services.audit import write_audit_log
from app.services.importer import parse_workbook

router = APIRouter(prefix="/import", tags=["import"])


@router.post("/parse", response_model=ImportParseResponse)
async def parse_import_file(
    file: UploadFile,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload an .xlsx file")

    contents = await file.read()
    try:
        rows = parse_workbook(db, contents)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not read file: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No data rows found in the file")

    return {
        "rows": rows,
        "total_rows": len(rows),
        "valid_rows": sum(1 for r in rows if not r.errors),
        "error_rows": sum(1 for r in rows if r.errors),
        "duplicate_rows": sum(1 for r in rows if r.is_duplicate),
    }


def _get_or_create_vessel(db: Session, name: str, created_by) -> Vessel:
    vessel = db.query(Vessel).filter(Vessel.name.ilike(name)).first()
    if not vessel:
        vessel = Vessel(name=name, created_by=created_by)
        db.add(vessel)
        db.flush()
    return vessel


def _get_or_create_vendor(db: Session, name: str, created_by) -> Vendor:
    vendor = db.query(Vendor).filter(Vendor.name.ilike(name)).first()
    if not vendor:
        vendor = Vendor(name=name, created_by=created_by)
        db.add(vendor)
        db.flush()
    return vendor


@router.post("/commit", response_model=ImportCommitResponse)
def commit_import(
    payload: ImportCommitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.EDITOR)),
) -> dict:
    inserted = updated = skipped = 0
    errors: list[str] = []

    entry_fields = [
        "dpr_no",
        "dpr_date",
        "service_details",
        "amount_inr",
        "fc_amount",
        "currency",
        "payment_date",
        "payment_reference",
        "followup_status",
        "last_known_remark",
        "reminder_1_sent_date",
        "reminder_2_sent_date",
        "final_invoice_received",
        "invoice_no",
        "invoice_date",
        "notes",
    ]

    for row in payload.rows:
        if row.decision == "skip":
            skipped += 1
            continue

        try:
            with db.begin_nested():
                vessel = _get_or_create_vessel(db, row.vessel_name, current_user.id)
                vendor = _get_or_create_vendor(db, row.vendor_name, current_user.id)
                values = {f: getattr(row, f) for f in entry_fields}
                values["vessel_id"] = vessel.id
                values["vendor_id"] = vendor.id

                if row.decision == "insert":
                    if db.query(PiEntry).filter(PiEntry.dpr_no == row.dpr_no).first():
                        raise ValueError(f"DPR No. '{row.dpr_no}' already exists (row {row.row_number})")
                    db.add(PiEntry(**values, created_by=current_user.id))
                    inserted += 1
                else:  # update
                    entry = db.get(PiEntry, row.existing_id) if row.existing_id else None
                    if not entry:
                        raise ValueError(f"Row {row.row_number}: existing entry not found for update")
                    for f, v in values.items():
                        setattr(entry, f, v)
                    entry.updated_by = current_user.id
                    updated += 1
        except Exception as exc:
            errors.append(str(exc))

    if inserted or updated:
        write_audit_log(
            db,
            entity_type=AuditEntityType.IMPORT_BATCH,
            entity_id=uuid.uuid4(),
            action=AuditAction.IMPORT,
            changed_by=current_user.id,
            summary=(
                f"{current_user.full_name} imported {inserted + updated} PI entries from Excel "
                f"({inserted} added, {updated} updated, {skipped} skipped)"
            ),
        )
    db.commit()

    return {"inserted": inserted, "updated": updated, "skipped": skipped, "failed": len(errors), "errors": errors}
