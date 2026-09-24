import uuid
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.schemas.base import CamelModel

if TYPE_CHECKING:
    from app.models.vessel import Vessel


class VesselOut(CamelModel):
    id: uuid.UUID
    name: str
    imo_number: str | None
    is_active: bool
    assigned_ta_id: uuid.UUID | None = None
    assigned_ta_name: str | None = None
    assigned_ta_email: str | None = None

    @staticmethod
    def from_vessel(vessel: "Vessel") -> "VesselOut":
        return VesselOut(
            id=vessel.id,
            name=vessel.name,
            imo_number=vessel.imo_number,
            is_active=vessel.is_active,
            assigned_ta_id=vessel.assigned_ta_id,
            assigned_ta_name=vessel.assigned_ta.full_name if vessel.assigned_ta else None,
            assigned_ta_email=vessel.assigned_ta.email if vessel.assigned_ta else None,
        )


class VendorOut(CamelModel):
    id: uuid.UUID
    name: str
    email: str | None
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
    assigned_ta_id: uuid.UUID | None = None


class VendorUpdateRequest(CamelModel):
    name: str | None = None
    email: str | None = None
    is_active: bool | None = None
