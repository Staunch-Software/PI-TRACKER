from app.schemas.base import CamelModel


class TableLayoutPreferenceOut(CamelModel):
    table_key: str
    column_order: list[str]
    column_widths: dict[str, int]
    page_size: int | None


class TableLayoutPreferenceUpsertRequest(CamelModel):
    column_order: list[str] | None = None
    column_widths: dict[str, int] | None = None
    page_size: int | None = None
