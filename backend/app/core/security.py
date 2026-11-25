import bcrypt
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings

SESSION_COOKIE_NAME = "pi_session"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60  # 7 days

_serializer = URLSafeTimedSerializer(settings.session_secret, salt="pi-tracker-session")


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))


def create_session_token(user_id: str, token_version: int = 1) -> str:
    return _serializer.dumps({"user_id": user_id, "tv": token_version})


def read_session_token(token: str) -> tuple[str, int] | None:
    try:
        data = _serializer.loads(token, max_age=SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    user_id = data.get("user_id")
    tv = data.get("tv")
    if not isinstance(user_id, str) or isinstance(tv, bool) or not isinstance(tv, int):
        return None
    return user_id, tv
