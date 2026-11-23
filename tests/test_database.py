"""Schema versions, the SQLite -> PostgreSQL move, backups and test restores.

PostgreSQL parts run when NYAAY_TEST_PG_SCRATCH_URL points at an empty throw-away database (skipped otherwise)."""
import os
import sqlite3
from datetime import date, datetime

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app import dbtool
from app.db import Base, head_version, make_engine, schema_version, upgrade_db
from app.models import Firm, GoldEntry, Matter, User

PG = os.environ.get("NYAAY_TEST_PG_SCRATCH_URL")
needs_pg = pytest.mark.skipif(not PG, reason="set NYAAY_TEST_PG_SCRATCH_URL to an empty scratch PostgreSQL database")


def _wipe_pg(url):
    eng = make_engine(url)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE"))
        c.execute(text("CREATE SCHEMA public"))
    eng.dispose()


def _fill(url):
    """A small firm with every awkward type: JSON, dates, booleans, unicode, nulls."""
    upgrade_db(url)
    eng = make_engine(url)
    with Session(eng) as s:
        f = Firm(name="Labana & Associates — चेम्बर", settings={"court": "Mumbai", "flags": [1, 2]})
        s.add(f)
        s.flush()
        s.add(User(firm_id=f.id, email="a@firm.test", name="A", password_hash="x", role="owner",
                   last_brief_on=date(2026, 1, 31), whatsapp_brief=True, last_login=datetime(2026, 2, 1, 9, 30, 15, 123456)))
        for i in range(2500):  # more than one batch
            s.add(Matter(firm_id=f.id, title=f"Matter {i}"))
        s.add(GoldEntry(firm_id=f.id, jid="sc-2019-1", title="Basalingappa v Mudibasappa", key_paras=[23, 25],
                        issues=["s.139 presumption"], status="verified"))
        s.commit()
    eng.dispose()


# ------------------------------------------------------------------ versions

def test_new_database_is_created_at_newest_version_and_matches_models(tmp_path):
    from alembic import command

    url = f"sqlite:///{tmp_path}/new.db"
    assert upgrade_db(url) == head_version()
    from app.db import alembic_config

    command.check(alembic_config(url))  # raises if migrations and models disagree
    assert upgrade_db(url) == head_version()  # running again is harmless


def test_database_from_before_migrations_is_upgraded_in_place_without_losing_data(tmp_path):
    from app.migrations.baseline_tables import BASELINE_TABLES

    url = f"sqlite:///{tmp_path}/old.db"
    eng = make_engine(url)
    old = [t for t in Base.metadata.sorted_tables if t.name in BASELINE_TABLES]
    Base.metadata.create_all(eng, tables=old)
    with eng.begin() as c:  # an old copy that lacks a column added later
        c.execute(text("DROP INDEX ix_users_calendar_token_hash"))
        c.execute(text("ALTER TABLE users DROP COLUMN calendar_token_hash"))
        c.execute(text("INSERT INTO firms (name) VALUES ('Old firm')"))
    assert schema_version(eng) is None
    eng.dispose()

    assert upgrade_db(url) == head_version()
    eng = make_engine(url)
    insp = inspect(eng)
    assert "calendar_token_hash" in {c["name"] for c in insp.get_columns("users")}
    assert "ix_users_calendar_token_hash" in {i["name"] for i in insp.get_indexes("users")}
    assert "gold_entries" in insp.get_table_names()
    from alembic import command
    from app.db import alembic_config

    command.check(alembic_config(url))  # an upgraded old database ends up exactly like a new one
    with eng.connect() as c:
        assert c.execute(text("select name from firms")).scalar() == "Old firm"
    eng.dispose()


def test_sqlite_runs_in_wal_mode_with_foreign_keys(tmp_path):
    eng = make_engine(f"sqlite:///{tmp_path}/w.db")
    with eng.connect() as c:
        assert c.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1
    eng.dispose()


# ------------------------------------------------------------------ move

def test_move_copies_every_row_and_checks_it(tmp_path):
    src, dst = f"sqlite:///{tmp_path}/a.db", f"sqlite:///{tmp_path}/b.db"
    _fill(src)
    counts = dbtool.move(src, dst, log=lambda *_: None)
    assert counts["matters"] == 2500 and counts["gold_entries"] == 1
    a, b = make_engine(src), make_engine(dst)
    for t in Base.metadata.sorted_tables:
        assert dbtool.table_checksum(a, t) == dbtool.table_checksum(b, t), t.name
    a.dispose()
    b.dispose()


def test_move_refuses_a_target_with_data_and_dry_run_writes_nothing(tmp_path):
    src, dst, dry = (f"sqlite:///{tmp_path}/{n}.db" for n in ("a", "b", "c"))
    _fill(src)
    _fill(dst)
    with pytest.raises(SystemExit, match="already has data"):
        dbtool.move(src, dst, log=lambda *_: None)
    dbtool.move(src, dry, dry_run=True, log=lambda *_: None)
    assert not os.path.exists(f"{tmp_path}/c.db")
    with pytest.raises(SystemExit, match="same database"):
        dbtool.move(src, src)


def test_move_with_force_replaces_the_target(tmp_path):
    src, dst = f"sqlite:///{tmp_path}/a.db", f"sqlite:///{tmp_path}/b.db"
    _fill(src)
    _fill(dst)
    dbtool.move(src, dst, force=True, log=lambda *_: None)
    assert dbtool.row_counts(make_engine(dst))["firms"] == 1


@needs_pg
def test_move_sqlite_to_postgres_then_the_app_can_keep_adding_rows(tmp_path):
    _wipe_pg(PG)
    src = f"sqlite:///{tmp_path}/a.db"
    _fill(src)
    dbtool.move(src, PG, log=lambda *_: None)
    eng = make_engine(PG)
    assert schema_version(eng) == head_version()
    with Session(eng) as s:  # ids were copied: the id counters must have moved past them
        m = Matter(firm_id=1, title="after the move")
        s.add(m)
        s.commit()
        assert m.id == 2501
        assert s.get(Firm, 1).settings == {"court": "Mumbai", "flags": [1, 2]}
        assert s.get(User, 1).last_login == datetime(2026, 2, 1, 9, 30, 15, 123456)
    eng.dispose()


# ------------------------------------------------------------------ backup / restore

def test_sqlite_backup_restore_and_verify(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/firm.db"
    _fill(url)
    f = dbtool.backup(url, out_dir=str(tmp_path / "bk"))
    monkeypatch.setattr(dbtool.config, "BACKUP_DIR", str(tmp_path / "bk"))
    r = dbtool.verify_backup()
    assert r["ok"] and r["integrity"] == "ok" and r["rows"]["matters"] == 2500 and r["file"] == str(f)

    with pytest.raises(SystemExit, match="already exists"):
        dbtool.restore(str(f), url)
    eng = make_engine(url)
    with eng.begin() as c:
        c.execute(text("DELETE FROM gold_entries"))
    eng.dispose()
    dbtool.restore(str(f), url, force=True)
    assert dbtool.row_counts(make_engine(url))["gold_entries"] == 1
    assert os.path.exists(f"{tmp_path}/firm.db.before-restore")


def test_backups_keep_only_the_newest(tmp_path):
    url = f"sqlite:///{tmp_path}/firm.db"
    upgrade_db(url)
    import time

    for _ in range(4):
        dbtool.backup(url, out_dir=str(tmp_path / "bk"), keep=2)
        time.sleep(1.05)
    assert len(list((tmp_path / "bk").glob("nyaai-*.db"))) == 2


def test_verify_notices_a_broken_backup(tmp_path):
    bad = tmp_path / "nyaai-20260101-000000.db"
    c = sqlite3.connect(str(bad))
    c.execute("create table firms (id integer primary key)")  # not a Nyaay database at the right version
    c.commit()
    c.close()
    r = dbtool.verify_backup(str(bad))
    assert r["ok"] is False


@needs_pg
@pytest.mark.skipif(not __import__("shutil").which("pg_dump"), reason="pg_dump not installed")
def test_postgres_backup_and_test_restore(tmp_path, monkeypatch):
    _wipe_pg(PG)
    src = f"sqlite:///{tmp_path}/a.db"
    _fill(src)
    dbtool.move(src, PG, log=lambda *_: None)
    f = dbtool.backup(PG, out_dir=str(tmp_path / "bk"))
    assert f.suffix == ".dump"
    # restore into the same scratch database after emptying it: pg_restore runs in one transaction
    _wipe_pg(PG)
    dbtool.restore(str(f), PG)
    assert dbtool.row_counts(make_engine(PG))["matters"] == 2500


# ------------------------------------------------------------------ doctor

def test_doctor_reports_database_version():
    from app import doctor

    upgrade_db()
    rows = {r["name"] if isinstance(r, dict) else r[1]: r for r in doctor.check_database()}
    assert any("Database version" in str(k) for k in rows)
