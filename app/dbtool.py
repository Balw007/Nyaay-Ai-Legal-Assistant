"""Firm database tools. Run from the Nyaay folder.

  python -m app.dbtool status                          # which database, schema version, rows per table
  python -m app.dbtool upgrade                         # bring the schema to the newest version (start-up does this too)
  python -m app.dbtool move --to postgresql+psycopg://user:pass@host/nyaay
                                                       # copy everything from the current database into another one
                                                       # (usually SQLite -> PostgreSQL), then check every row arrived
  python -m app.dbtool backup                          # one backup now (SQLite copy, or pg_dump for PostgreSQL)
  python -m app.dbtool restore <file> [--to URL] --yes # put a backup back (the target must be empty unless --force)
  python -m app.dbtool verify-backup [<file>]          # restore a backup into a scratch database and check it

`move` never changes the source. It refuses to write into a database that already has data unless --force is given,
and --dry-run shows what would be copied without writing anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from sqlalchemy import func, inspect, select, text
from sqlalchemy.engine import make_url

from . import config
from .db import Base, head_version, make_engine, schema_version, upgrade_db

BATCH = 1000
KEEP = 14


def _safe(url: str) -> str:
    """URL without the password, for printing."""
    try:
        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return url.split("@")[-1]


def _tables():
    from . import models  # noqa: F401

    return list(Base.metadata.sorted_tables)  # parents before children, so foreign keys are always satisfied


def row_counts(eng) -> dict:
    have = set(inspect(eng).get_table_names())
    out = {}
    with eng.connect() as c:
        for t in _tables():
            out[t.name] = c.execute(select(func.count()).select_from(t)).scalar() if t.name in have else None
    return out


def _norm(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def table_checksum(eng, table) -> str:
    """Order-independent of the database engine: rows sorted by primary key, values normalised to JSON."""
    h = hashlib.sha256()
    pk = list(table.primary_key.columns)
    with eng.connect() as c:
        for row in c.execute(select(table).order_by(*pk)).mappings():
            h.update(json.dumps({k: _norm(v) for k, v in row.items()}, sort_keys=True, default=str).encode())
    return h.hexdigest()


# ------------------------------------------------------------------ status / upgrade

def cmd_status(_a) -> int:
    eng = make_engine(config.DATABASE_URL)
    print("database :", _safe(config.DATABASE_URL))
    print("schema   :", schema_version(eng) or "not versioned yet (start Nyaay once, or run: python -m app.dbtool upgrade)")
    print("newest   :", head_version())
    for name, n in row_counts(eng).items():
        print(f"  {name:<18} {'(missing)' if n is None else n}")
    eng.dispose()
    return 0


def cmd_upgrade(_a) -> int:
    print("schema is now", upgrade_db())
    return 0


# ------------------------------------------------------------------ move

def move(src_url: str, dst_url: str, force: bool = False, dry_run: bool = False, log=print) -> dict:
    if make_url(src_url) == make_url(dst_url):
        raise SystemExit("source and target are the same database")
    upgrade_db(src_url)  # same as starting Nyaay on it: only adds what is missing, never removes data
    src = make_engine(src_url)
    counts = row_counts(src)
    log(f"from {_safe(src_url)}  ({sum(v or 0 for v in counts.values())} rows)")
    if dry_run:
        for k, v in counts.items():
            log(f"  {k:<18} {v}")
        src.dispose()
        return counts

    upgrade_db(dst_url)
    dst = make_engine(dst_url)
    existing = {k: v for k, v in row_counts(dst).items() if v}
    if existing and not force:
        dst.dispose()
        src.dispose()
        raise SystemExit(f"target already has data ({', '.join(existing)}). Use an empty database, or --force to "
                         "replace everything in it.")
    tables = _tables()
    with dst.begin() as c:
        for t in reversed(tables):
            c.execute(t.delete())
        for t in tables:
            n = 0
            with src.connect() as s:
                result = s.execution_options(stream_results=True).execute(select(t))
                while rows := result.mappings().fetchmany(BATCH):
                    c.execute(t.insert(), [dict(r) for r in rows])
                    n += len(rows)
            log(f"  {t.name:<18} {n}")
        if dst.dialect.name == "postgresql":  # ids were copied as-is, so move each counter past the highest id
            for t in tables:
                for col in t.primary_key.columns:
                    if col.autoincrement is not False and col.type.python_type is int:
                        c.execute(text(f"SELECT setval(pg_get_serial_sequence('{t.name}', '{col.name}'), "
                                       f"COALESCE((SELECT MAX({col.name}) FROM {t.name}), 0) + 1, false)"))
    bad = [t.name for t in tables if table_checksum(src, t) != table_checksum(dst, t)]
    src.dispose()
    dst.dispose()
    if bad:
        raise SystemExit(f"copied, but these tables do not match the source: {', '.join(bad)}. Do not switch over.")
    log("checked: every table matches the source, row for row")
    return counts


def cmd_move(a) -> int:
    move(a.source or config.DATABASE_URL, a.to, force=a.force, dry_run=a.dry_run)
    if not a.dry_run:
        print("\nNext: set NYAAI_DATABASE_URL in .env to the new database and restart Nyaay. Keep the old file until "
              "you have checked a few matters in the app.")
    return 0


# ------------------------------------------------------------------ backup / restore / verify

def _pg_env(url: str) -> tuple[list, dict]:
    u = make_url(url)
    env = dict(os.environ)
    if u.password:
        env["PGPASSWORD"] = u.password
    args = ["-h", u.host or "localhost", "-p", str(u.port or 5432), "-U", u.username or "postgres"]
    return args + ["-d", u.database], env


def _need(prog: str) -> str:
    p = shutil.which(prog)
    if not p:
        raise SystemExit(f"{prog} not found. Install the PostgreSQL client tools (on the server image they are included).")
    return p


def backup(url: str | None = None, out_dir: str | None = None, keep: int = KEEP) -> Path:
    url = url or config.DATABASE_URL
    d = Path(out_dir or config.BACKUP_DIR)
    d.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    if url.startswith("sqlite"):
        src = make_url(url).database
        dst = d / f"nyaai-{stamp}.db"
        s, t = sqlite3.connect(src), sqlite3.connect(str(dst))
        with t:
            s.backup(t)  # consistent copy while the app is running
        s.close()
        t.close()
        pattern = "nyaai-*.db"
    else:
        args, env = _pg_env(url)
        dst = d / f"pg-{stamp}.dump"
        tmp = dst.with_suffix(".tmp")
        subprocess.run([_need("pg_dump"), "-Fc", "--no-owner", "-f", str(tmp)] + args, env=env, check=True)
        tmp.replace(dst)
        pattern = "pg-*.dump"
    for old in sorted(d.glob(pattern))[:-keep]:
        old.unlink()
    return dst


def latest_backup(out_dir: str | None = None) -> Path | None:
    files = sorted(Path(out_dir or config.BACKUP_DIR).glob("nyaai-*.db")) + \
        sorted(Path(out_dir or config.BACKUP_DIR).glob("pg-*.dump"))
    return max(files, key=lambda p: p.stat().st_mtime) if files else None


def restore(file: str, url: str, force: bool = False) -> None:
    f = Path(file)
    if not f.exists():
        raise SystemExit(f"no such backup: {f}")
    if url.startswith("sqlite"):
        if f.suffix != ".db":
            raise SystemExit("a PostgreSQL backup (.dump) goes into PostgreSQL; use --to postgresql+psycopg://...")
        target = Path(make_url(url).database)
        if target.exists() and target.stat().st_size and not force:
            raise SystemExit(f"{target} already exists. Use --force to replace it (a copy is kept as .before-restore).")
        if target.exists():
            shutil.copy2(target, target.with_suffix(target.suffix + ".before-restore"))
            for side in (target.with_name(target.name + "-wal"), target.with_name(target.name + "-shm")):
                side.unlink(missing_ok=True)
        s, t = sqlite3.connect(str(f)), sqlite3.connect(str(target))
        with t:
            s.backup(t)
        s.close()
        t.close()
        return
    eng = make_engine(url)
    has_data = any(row_counts(eng).values()) if "firms" in inspect(eng).get_table_names() else False
    eng.dispose()
    if has_data and not force:
        raise SystemExit("target database already has data. Use --force to replace it.")
    args, env = _pg_env(url)
    if f.suffix == ".db":  # SQLite backup into PostgreSQL: that is a move
        move(f"sqlite:///{f}", url, force=True)
        return
    subprocess.run([_need("pg_restore"), "--clean", "--if-exists", "--no-owner", "--single-transaction",
                    "--exit-on-error"] + args + [str(f)], env=env, check=True)


def verify_backup(file: str | None = None, scratch_url: str | None = None) -> dict:
    """Restore a backup somewhere harmless and check it is complete. A backup you have never restored is a hope."""
    f = Path(file) if file else latest_backup()
    if not f or not f.exists():
        raise SystemExit("no backup found. Run: python -m app.dbtool backup")
    report = {"file": str(f), "bytes": f.stat().st_size}
    if f.suffix == ".db":
        with tempfile.TemporaryDirectory() as td:
            tgt = Path(td) / "verify.db"
            restore(str(f), f"sqlite:///{tgt}")
            c = sqlite3.connect(str(tgt))
            report["integrity"] = c.execute("PRAGMA integrity_check").fetchone()[0]
            c.close()
            eng = make_engine(f"sqlite:///{tgt}")
            report["schema"] = schema_version(eng)
            report["rows"] = row_counts(eng)
            eng.dispose()
    else:
        scratch_url = scratch_url or os.environ.get("NYAAY_VERIFY_DATABASE_URL")
        if not scratch_url:
            raise SystemExit("set NYAAY_VERIFY_DATABASE_URL to an empty scratch PostgreSQL database for the test restore")
        restore(str(f), scratch_url, force=True)
        eng = make_engine(scratch_url)
        report["integrity"] = "ok"
        report["schema"] = schema_version(eng)
        report["rows"] = row_counts(eng)
        eng.dispose()
    report["ok"] = report["integrity"] == "ok" and report["schema"] == head_version() and \
        all(v is not None for v in report["rows"].values())
    return report


def cmd_backup(a) -> int:
    print("backup:", backup(keep=a.keep))
    return 0


def cmd_restore(a) -> int:
    if not a.yes:
        raise SystemExit("restoring replaces data. Stop Nyaay first, then add --yes to confirm.")
    restore(a.file, a.to or config.DATABASE_URL, force=a.force)
    print("restored. Start Nyaay: it will bring the schema up to date.")
    return 0


def cmd_verify(a) -> int:
    r = verify_backup(a.file)
    print(json.dumps(r, indent=2, default=str))
    return 0 if r["ok"] else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.dbtool", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("upgrade").set_defaults(fn=cmd_upgrade)
    m = sub.add_parser("move")
    m.add_argument("--to", required=True)
    m.add_argument("--from", dest="source")
    m.add_argument("--force", action="store_true")
    m.add_argument("--dry-run", action="store_true")
    m.set_defaults(fn=cmd_move)
    b = sub.add_parser("backup")
    b.add_argument("--keep", type=int, default=KEEP)
    b.set_defaults(fn=cmd_backup)
    r = sub.add_parser("restore")
    r.add_argument("file")
    r.add_argument("--to")
    r.add_argument("--force", action="store_true")
    r.add_argument("--yes", action="store_true")
    r.set_defaults(fn=cmd_restore)
    v = sub.add_parser("verify-backup")
    v.add_argument("file", nargs="?")
    v.set_defaults(fn=cmd_verify)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
