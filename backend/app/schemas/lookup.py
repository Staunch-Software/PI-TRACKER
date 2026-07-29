import uuid

from pydantic import BaseModel

from app.schemas.base import CamelModel


class VesselOut(CamelModel):
    id: uuid.UUID
    name: str
    imo_number: str | None
    is_active: bool


class VendorOut(CamelModel):
    id: uuid.UUID
    name: str
    is_active: bool


class LookupCreateRequest(BaseModel):
    name: str


class LookupUpdateRequest(CamelModel):
    name: str | None = None
    is_active: bool | None = None


class VesselCreateRequest(CamelModel):
    name: str
    imo_number: str


class VesselUpdateRequest(CamelModel):
    name: str | None = None
    imo_number: str | None = None
    is_active: bool | None = None
