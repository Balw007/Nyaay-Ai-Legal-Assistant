"""Scheduled jobs. Run from cron / Windows Task Scheduler / the docker 'jobs' service.

  python -m app.jobs brief     # 8 am: send each opted-in advocate their brief (Telegram, WhatsApp)
                               # (not needed while the app is running: it sends at 8 am IST by itself)
  python -m app.jobs sync      # nightly: pull every active matter with a CNR from eCourts
  python -m app.jobs backup    # nightly: copy the databases to NYAAI_BACKUP_DIR (keeps the last 14)
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

from .config import BACKUP_DIR, CORPUS_DB, DATABASE_URL
from .db import Base, SessionLocal, engine, migrate


def job_brief() -> int:
    """Send today's brief to everyone who switched it on (Telegram and/or WhatsApp), once per person per day."""
    from .services.brief_delivery import deliver_due

    with SessionLocal() as db:
        return deliver_due(db, respect_hour=False)


def job_sync() -> int:
    from .models import Matter
    from .routes.integrations import sync_matter
    from .services import ecourts

    if not ecourts.available():
        print("ECOURTSINDIA_TOKEN not set")
        return 0
    n = 0
    with SessionLocal() as db:
        for m in db.query(Matter).filter(Matter.status == "active", Matter.cnr.isnot(None)).all():
            try:
                r = sync_matter(db, m)
                n += 1
                print(m.id, m.title[:50], r)
            except Exception as exc:
                m.sync_status = f"Failed: {exc}"[:300]
                db.commit()
                print(m.id, "failed:", exc)
    return n


def _sqlite_copy(src: str, dst: Path) -> None:
    s = sqlite3.connect(src)
    d = sqlite3.connect(str(dst))
    with d:
        s.backup(d)  # consistent copy while the app is running
    s.close()
    d.close()


def job_backup() -> list:
    out_dir = Path(BACKUP_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    made = []
    if DATABASE_URL.startswith("sqlite:///"):
        src = DATABASE_URL.replace("sqlite:///", "", 1)
        if Path(src).exists():
            dst = out_dir / f"nyaai-{stamp}.db"
            _sqlite_copy(src, dst)
            made.append(str(dst))
    else:
        print("Postgres: use pg_dump (the docker 'backup' service does this).")
    if Path(CORPUS_DB).exists():
        dst = out_dir / f"corpus-{stamp}.db"
        _sqlite_copy(CORPUS_DB, dst)
        made.append(str(dst))
    for pattern in ("nyaai-*.db", "corpus-*.db"):
        for old in sorted(out_dir.glob(pattern))[:-14]:
            old.unlink()
    for m in made:
        print("backup:", m)
    return made


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.jobs", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", choices=["brief", "sync", "backup"])
    a = ap.parse_args(argv)
    Base.metadata.create_all(engine)
    migrate()
    {"brief": job_brief, "sync": job_sync, "backup": job_backup}[a.job]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
