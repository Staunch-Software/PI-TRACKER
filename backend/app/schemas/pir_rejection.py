from datetime import date

from app.schemas.base import CamelModel


class PirRejectionSummaryEntry(CamelModel):
    rejected_by: str
    count: int


class PirRejectionDailyEntry(CamelModel):
    date: date
    rejected_by: str
    count: int
