import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.core.enums import UserRole
from app.schemas.base import CamelModel


class UserOut(CamelModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: UserRole
    is_active: bool
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(CamelModel):
    current_password: str
    new_password: str
