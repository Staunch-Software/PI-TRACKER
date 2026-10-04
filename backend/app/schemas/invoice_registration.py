from datetime import date

from app.schemas.base import CamelModel


class InvoiceRegistrationSummaryEntry(CamelModel):
    registered_by: str
    count: int


class InvoiceRegistrationDailyEntry(CamelModel):
    date: date
    registered_by: str
    count: int
