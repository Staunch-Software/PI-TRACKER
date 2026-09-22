from pydantic import EmailStr

from app.core.enums import UserRole
from app.schemas.base import CamelModel


class UserCreateRequest(CamelModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole = UserRole.VIEWER
    # Both default True — a newly created user starts with full module access unless the admin
    # creating them explicitly unchecks one, same "narrows rather than silently restricts" stance
    # as the migration default (see 0009_user_module_access.py).
    can_access_pi: bool = True
    can_access_pir: bool = True
    can_access_soa: bool = True


class UserUpdateRequest(CamelModel):
    full_name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    can_access_pi: bool | None = None
    can_access_pir: bool | None = None
    can_access_soa: bool | None = None
    password: str | None = None
