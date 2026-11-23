"""Alembic environment. Run through Nyaay (`python -m app.dbtool upgrade`), or plain `alembic` from the repo root."""
from alembic import context
from sqlalchemy import pool

from app import models  # noqa: F401
from app.config import DATABASE_URL
from app.db import Base, make_engine

config = context.config
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline():
    context.configure(url=config.get_main_option("sqlalchemy.url"), target_metadata=target_metadata,
                      literal_binds=True, render_as_batch=True, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    url = config.get_main_option("sqlalchemy.url")
    eng = make_engine(url)
    with eng.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata,
                          render_as_batch=conn.dialect.name == "sqlite", compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    eng.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
