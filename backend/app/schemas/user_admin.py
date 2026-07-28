from pydantic import EmailStr

from app.core.enums import UserRole
from app.schemas.base import CamelModel


class UserCreateRequest(CamelModel):
    email: EmailStr
    full_name: str
    password: str
    role: UserRole = UserRole.VIEWER


class UserUpdateRequest(CamelModel):
    full_name: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None
