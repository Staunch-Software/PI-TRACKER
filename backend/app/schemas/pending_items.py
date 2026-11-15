from datetime import date

from app.schemas.base import CamelModel


class PendingItemOut(CamelModel):
    stage: str  # "Requisition" | "Purchase Order" | "Invoice"
    reference_no: str | None
    vessel_name: str | None
    vendor: str | None
    status: str | None
    owner_role: str  # "TSI" | "TA"
    owner_name: str | None
    ageing_days: int | None
    reference_date: date | None


class PendingItemsFilterOptions(CamelModel):
    vessel_name: list[str]
    stage: list[str]
    owner_name: list[str]
    status: list[str]


class PendingItemsCountEntry(CamelModel):
    """One (stage, owner_role) combination's row count — drives the tab/sub-tab badges on the
    frontend, e.g. "Requisition" tab > "TSI Pending" sub-tab shows this count."""

    stage: str
    owner_role: str
    count: int
