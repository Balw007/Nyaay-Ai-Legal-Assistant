"""Firm database: engine, sessions and schema upgrades.

SQLite (one file, fine for a single office PC) or PostgreSQL (servers and more than a few users):
    NYAAI_DATABASE_URL=postgresql+psycopg://user:password@host:5432/nyaay

Schema changes are Alembic migrations in app/migrations/versions. `upgrade_db()` runs at start-up and brings any
database to the newest version. A database made by an older Nyaay (before migrations existed) is first completed the
old way and then marked as the baseline version, so nobody has to rebuild anything by hand.
"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import DATABASE_URL

IS_SQLITE = DATABASE_URL.startswith("sqlite")
MIGRATIONS = Path(__file__).resolve().parent / "migrations"
_LOCK_ID = 7_311_904_221  # pg advisory lock key: one Nyaay process upgrades the schema at a time


def make_engine(url: str):
    if url.startswith("sqlite"):
        eng = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

        @event.listens_for(eng, "connect")
        def _pragmas(dbapi_conn, _):  # WAL lets the web app read while a job writes; FKs are off in SQLite by default
            cur = dbapi_conn.cursor()
            try:
                if ":memory:" not in url:
                    cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA busy_timeout=30000")
            finally:
                cur.close()
        return eng
    return create_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20, pool_recycle=1800, pool_timeout=30)


engine = make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate(eng=None) -> None:
    """Legacy upgrade for databases made before migrations existed: add missing nullable columns.
    Only `upgrade_db()` calls this, once, before stamping such a database as the baseline."""
    eng = eng or engine
    insp = inspect(eng)
    existing_tables = set(insp.get_table_names())
    with eng.begin() as c:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {col["name"] for col in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl_type = col.type.compile(dialect=eng.dialect)
                c.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {ddl_type}'))
    insp = inspect(eng)  # indexes on columns that were added later
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        have_ix = {ix["name"] for ix in insp.get_indexes(table.name)}
        for ix in table.indexes:
            if ix.name not in have_ix:
                ix.create(eng)


def alembic_config(url: str | None = None):
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", (url or DATABASE_URL).replace("%", "%%"))
    return cfg


BASELINE = "0001_baseline"


def schema_version(eng=None) -> str | None:
    eng = eng or engine
    if "alembic_version" not in inspect(eng).get_table_names():
        return None
    with eng.connect() as c:
        return c.execute(text("select version_num from alembic_version")).scalar()


def head_version() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(alembic_config()).get_current_head()


def upgrade_db(url: str | None = None) -> str:
    """Bring the database at `url` (default: the app's) to the newest schema. Safe to call on every start."""
    from alembic import command

    from . import models  # noqa: F401  (registers every table on Base.metadata)

    eng = engine if url in (None, DATABASE_URL) else make_engine(url)
    cfg = alembic_config(url)
    pg = eng.dialect.name == "postgresql"
    lock = eng.connect() if pg else None
    try:
        if lock is not None:
            lock.execute(text("select pg_advisory_lock(:k)"), {"k": _LOCK_ID})
        tables = set(inspect(eng).get_table_names())
        if "alembic_version" not in tables and "firms" in tables:
            # made by an older Nyaay: finish it the old way, then mark it as the baseline
            Base.metadata.create_all(eng, tables=_baseline_tables())
            migrate(eng)
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
        return schema_version(eng) or ""
    finally:
        if lock is not None:
            lock.execute(text("select pg_advisory_unlock(:k)"), {"k": _LOCK_ID})
            lock.close()
        if eng is not engine:
            eng.dispose()


def _baseline_tables():
    from .migrations.baseline_tables import BASELINE_TABLES

    return [t for t in Base.metadata.sorted_tables if t.name in BASELINE_TABLES]
