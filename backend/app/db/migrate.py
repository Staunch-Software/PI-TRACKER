from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import settings

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent


def run_pending_migrations() -> None:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # configparser treats "%" as interpolation syntax, so a literal "%" in the DB
    # password (e.g. URL-encoded "@" as "%40") must be escaped as "%%" here.
    cfg.set_main_option("sqlalchemy.url", settings.database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")
