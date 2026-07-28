from typing import Generic, TypeVar

from app.schemas.base import CamelModel

T = TypeVar("T")


class PaginatedResult(CamelModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
