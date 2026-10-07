import uuid
from datetime import date, datetime

from pydantic import Field, field_validator

from app.core.enums import OilType
from app.schemas.base import CamelModel

_TEXT_MAX = 255


class _TextFieldsMixin(CamelModel):
    # Blank/whitespace-only text is stored as NULL.
    @field_validator("port", "shipment_status", "report_status", mode="before", check_fields=False)
    @classmethod
    def _strip_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class LandingReportCreate(_TextFieldsMixin):
    vessel_id: uuid.UUID
    port: str | None = Field(default=None, max_length=_TEXT_MAX)
    oil_type: OilType
    offlanded_date: date | None = None
    shipment_status: str | None = Field(default=None, max_length=_TEXT_MAX)
    report_status: str | None = Field(default=None, max_length=_TEXT_MAX)


class LandingReportUpdate(_TextFieldsMixin):
    vessel_id: uuid.UUID | None = None
    port: str | None = Field(default=None, max_length=_TEXT_MAX)
    oil_type: OilType | None = None
    offlanded_date: date | None = None
    shipment_status: str | None = Field(default=None, max_length=_TEXT_MAX)
    report_status: str | None = Field(default=None, max_length=_TEXT_MAX)


class LandingReportOut(CamelModel):
    id: uuid.UUID
    seq_no: int
    vessel_id: uuid.UUID
    vessel_name: str
    port: str | None
    oil_type: OilType
    offlanded_date: date | None
    shipment_status: str | None
    report_status: str | None
    created_at: datetime
    updated_at: datetime
