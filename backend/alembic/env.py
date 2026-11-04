from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    # disable_existing_loggers=False — the default (True) silently disables every logger that
    # already exists at this point and isn't explicitly listed in alembic.ini's [loggers] section.
    # Since migrations run on every backend startup (app.main's lifespan calls
    # run_pending_migrations()), that was disabling every app-level `logging.getLogger(__name__)`
    # logger app-wide (detail_scraper.py, po_scraper, pir_scraper, etc.) for the process's whole
    # lifetime — confirmed 2026-11-04 investigating why a completed "Scrape All Vendor Details" run
    # had zero [VENDOR] log lines anywhere in the journal, at any time window: none of those
    # warnings/errors were ever actually being emitted.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


from app.core.config import settings

def run_migrations_online() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = str(settings.database_url)
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
