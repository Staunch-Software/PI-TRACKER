import difflib
import json
import uuid
from collections import Counter

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.enums import AuditAction, AuditEntityType, Department, UserRole
from app.db.session import get_db
from app.models.user import User
from app.models.vendor_department_mapping import VendorDepartmentMapping
from app.schemas.vendor_department_mapping import (
    VendorImportCommitRequest,
    VendorImportCommitResponse,
    VendorImportParseResponse,
    VendorImportRejectedRow,
    VendorMappingCreateRequest,
    VendorMappingHealthCheckOut,
    VendorMappingOut,
    VendorMappingUpdateRequest,
)
from app.services.audit import diff_fields, write_audit_log
from app.services.vendor_mapping_importer import (
    normalize_vendor_name,
    parse_department,
    parse_rows,
    read_headers,
    resolve_confident_mapping,
)

router = APIRouter(prefix="/vendor-mapping", tags=["vendor-mapping"])


@router.get("", response_model=list[VendorMappingOut])
def list_vendor_mappings(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
    include_inactive: bool = Query(default=False),
    search: str | None = Query(default=None),
    department: Department | None = Query(default=None),
) -> list[VendorDepartmentMapping]:
    query = db.query(VendorDepartmentMapping)
    if not include_inactive:
        query = query.filter(VendorDepartmentMapping.active.is_(True))
    if department:
        query = query.filter(VendorDepartmentMapping.department == department.value)
    if search:
        query = query.filter(VendorDepartmentMapping.vendor_name_normalized.contains(normalize_vendor_name(search)))
    return query.order_by(VendorDepartmentMapping.vendor_name).all()


@router.get("/health-check", response_model=VendorMappingHealthCheckOut)
def vendor_mapping_health_check(
    db: Session = Depends(get_db), _: User = Depends(require_roles(UserRole.ADMIN))
) -> dict:
    """Flags active Manning mappings with ZERO matching PIR invoices — the permanent fix for the
    "vendor mapped but spelled slightly differently from what SmartPAL actually scraped" class of
    bug (confirmed live 2026-09-02/03: e.g. "Manish travels" vs SmartPAL's actual "Manish Travels
    & Tours", and a bogus combined row "SAMSARA SHIPPING / MERCHANT SHIPPING" that matched
    neither real vendor). Matching itself stays exact (see vendor_mapping_importer.
    normalize_vendor_name / the join in pir_entries.py) — a fuzzy fallback there risks real false
    Manning classifications across vendors sharing common words ("marine", "shipping",
    "medical"). This endpoint's fuzzy suggestions are advisory-only, for a human to review and
    apply via the normal edit/create flow — never auto-applied.

    Zero matches is NOT necessarily a bug — plenty of mapped vendors simply have no open PIR
    invoices right now. difflib's cutoff is intentionally lenient (candidates are suggestions,
    not conclusions) so this over-suggests rather than under-suggests; a human still has to
    recognize "Best Marine Private Limited" as the same company as "Best marine" and reject
    unrelated matches like "ROSHAN MEDICAL" showing up for "Balaji Medical" (confirmed live —
    difflib does produce those false positives; that's expected and fine for an advisory list)."""
    mappings = (
        db.query(VendorDepartmentMapping).filter(VendorDepartmentMapping.active.is_(True)).order_by(VendorDepartmentMapping.vendor_name).all()
    )

    pir_vendor_counts = Counter()
    pir_norm_to_raw: dict[str, str] = {}
    for raw, norm in db.execute(
        text("SELECT vendor_name, vendor_name_normalized FROM pir_entries WHERE vendor_name IS NOT NULL")
    ):
        pir_vendor_counts[raw] += 1
        pir_norm_to_raw.setdefault(norm, raw)

    matched_norms = set(
        row[0]
        for row in db.execute(
            text(
                "SELECT DISTINCT m.vendor_name_normalized FROM vendor_department_mapping m "
                "JOIN pir_entries p ON p.vendor_name_normalized = m.vendor_name_normalized "
                "WHERE m.active = TRUE"
            )
        )
    )

    issues = []
    for m in mappings:
        if m.vendor_name_normalized in matched_norms:
            continue
        candidate_norms = difflib.get_close_matches(m.vendor_name_normalized, pir_norm_to_raw.keys(), n=3, cutoff=0.7)
        candidates = [
            {"vendor_name": pir_norm_to_raw[n], "invoice_count": pir_vendor_counts[pir_norm_to_raw[n]]}
            for n in candidate_norms
        ]
        issues.append(
            {
                "mapping_id": m.id,
                "vendor_name": m.vendor_name,
                "department": m.department,
                "candidates": candidates,
            }
        )

    return {
        "total_active_mappings": len(mappings),
        "unmatched_count": len(issues),
        "issues": issues,
    }


def _check_duplicate(db: Session, vendor_name: str, exclude_id: uuid.UUID | None = None) -> None:
    normalized = normalize_vendor_name(vendor_name)
    query = db.query(VendorDepartmentMapping).filter(VendorDepartmentMapping.vendor_name_normalized == normalized)
    if exclude_id:
        query = query.filter(VendorDepartmentMapping.id != exclude_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"'{vendor_name}' is already mapped")


@router.post("", response_model=VendorMappingOut, status_code=status.HTTP_201_CREATED)
def create_vendor_mapping(
    payload: VendorMappingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> VendorDepartmentMapping:
    _check_duplicate(db, payload.vendor_name)

    mapping = VendorDepartmentMapping(
        vendor_name=payload.vendor_name,
        vendor_name_normalized=normalize_vendor_name(payload.vendor_name),
        department=payload.department.value,
    )
    db.add(mapping)
    db.flush()

    write_audit_log(
        db,
        entity_type=AuditEntityType.VENDOR_MAPPING,
        entity_id=mapping.id,
        action=AuditAction.CREATE,
        changed_by=current_user.id,
        summary=f"{current_user.full_name} mapped vendor {mapping.vendor_name} to {payload.department.value}",
    )
    db.commit()
    db.refresh(mapping)
    return mapping


@router.patch("/{mapping_id}", response_model=VendorMappingOut)
def update_vendor_mapping(
    mapping_id: uuid.UUID,
    payload: VendorMappingUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> VendorDepartmentMapping:
    mapping = db.get(VendorDepartmentMapping, mapping_id)
    if not mapping:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor mapping not found")

    updates = payload.model_dump(exclude_unset=True)
    if "department" in updates and updates["department"] is not None:
        updates["department"] = updates["department"].value

    if "vendor_name" in updates and updates["vendor_name"] and updates["vendor_name"] != mapping.vendor_name:
        _check_duplicate(db, updates["vendor_name"], exclude_id=mapping_id)
        updates["vendor_name_normalized"] = normalize_vendor_name(updates["vendor_name"])

    if updates:
        before = {field: getattr(mapping, field) for field in updates}
        for field, value in updates.items():
            setattr(mapping, field, value)

        changes = diff_fields(before, updates)
        if changes:
            write_audit_log(
                db,
                entity_type=AuditEntityType.VENDOR_MAPPING,
                entity_id=mapping.id,
                action=AuditAction.UPDATE,
                changed_by=current_user.id,
                summary=f"{current_user.full_name} updated vendor mapping {mapping.vendor_name} ({', '.join(changes.keys())})",
                changes=changes,
            )

    db.commit()
    db.refresh(mapping)
    return mapping


# ── Bulk import ──────────────────────────────────────────────────────────────────


@router.post("/import/parse", response_model=VendorImportParseResponse)
async def parse_vendor_import_file(
    file: UploadFile,
    column_mapping: str | None = Form(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.ADMIN)),
) -> VendorImportParseResponse:
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload an .xlsx file")

    contents = await file.read()
    try:
        headers, sheet = read_headers(contents)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not read file: {exc}") from exc

    if not headers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No header row found in the file")

    mapping: dict[str, int] | None = None
    if column_mapping:
        try:
            raw_mapping = json.loads(column_mapping)
            mapping = {"vendor_name": int(raw_mapping["vendorName"]), "department": int(raw_mapping["department"])}
        except (KeyError, ValueError, TypeError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid column mapping") from exc
    else:
        mapping = resolve_confident_mapping(headers)

    if mapping is None:
        return VendorImportParseResponse(needs_mapping=True, headers=headers)

    rows = parse_rows(db, sheet, mapping)
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No data rows found in the file")

    return VendorImportParseResponse(
        rows=rows,
        total_rows=len(rows),
        valid_rows=sum(1 for r in rows if not r.errors),
        error_rows=sum(1 for r in rows if r.errors),
    )


@router.post("/import/commit", response_model=VendorImportCommitResponse)
def commit_vendor_import(
    payload: VendorImportCommitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
) -> dict:
    inserted = updated = 0
    rejected: list[VendorImportRejectedRow] = []

    for row in payload.rows:
        vendor_name = row.vendor_name.strip()
        if not vendor_name:
            rejected.append(VendorImportRejectedRow(row_number=row.row_number, reason="vendor name is required"))
            continue

        department, err = parse_department(row.department.value)
        if err:
            rejected.append(VendorImportRejectedRow(row_number=row.row_number, reason=err))
            continue

        normalized = normalize_vendor_name(vendor_name)
        existing = db.query(VendorDepartmentMapping).filter(VendorDepartmentMapping.vendor_name_normalized == normalized).first()
        if existing:
            existing.department = department.value
            existing.active = True
            updated += 1
        else:
            db.add(
                VendorDepartmentMapping(
                    vendor_name=vendor_name,
                    vendor_name_normalized=normalized,
                    department=department.value,
                )
            )
            inserted += 1

    if inserted or updated:
        write_audit_log(
            db,
            entity_type=AuditEntityType.VENDOR_MAPPING_IMPORT_BATCH,
            entity_id=uuid.uuid4(),
            action=AuditAction.IMPORT,
            changed_by=current_user.id,
            summary=(
                f"{current_user.full_name} imported vendor mappings from Excel "
                f"({inserted} added, {updated} updated, {len(rejected)} rejected)"
            ),
        )
    db.commit()

    return {"inserted": inserted, "updated": updated, "rejected": rejected}
