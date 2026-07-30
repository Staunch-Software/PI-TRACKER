from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.table_layout_preference import TableLayoutPreference
from app.models.user import User
from app.schemas.table_layout import TableLayoutPreferenceOut, TableLayoutPreferenceUpsertRequest

router = APIRouter(prefix="/table-layout", tags=["table-layout"])


@router.get("/{table_key}", response_model=TableLayoutPreferenceOut | None)
def get_table_layout(
    table_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TableLayoutPreference | None:
    return (
        db.query(TableLayoutPreference)
        .filter(TableLayoutPreference.user_id == current_user.id, TableLayoutPreference.table_key == table_key)
        .first()
    )


@router.put("/{table_key}", response_model=TableLayoutPreferenceOut)
def upsert_table_layout(
    table_key: str,
    payload: TableLayoutPreferenceUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TableLayoutPreference:
    row = (
        db.query(TableLayoutPreference)
        .filter(TableLayoutPreference.user_id == current_user.id, TableLayoutPreference.table_key == table_key)
        .first()
    )
    if not row:
        row = TableLayoutPreference(
            user_id=current_user.id, table_key=table_key, column_order=[], column_widths={}
        )
        db.add(row)

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return row
