"""Scheduled jobs. Run from cron / Windows Task Scheduler / the docker 'jobs' service.

  python -m app.jobs brief     # 8 am: send each opted-in advocate their brief (Telegram, WhatsApp)
                               # (not needed while the app is running: it sends at 8 am IST by itself)
  python -m app.jobs sync      # nightly: pull every active matter with a CNR from eCourts
  python -m app.jobs backup    # nightly: back up both databases to NYAAI_BACKUP_DIR (keeps 14)
                               # and test-restore the firm backup
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from .config import BACKUP_DIR, CORPUS_DB
from .db import SessionLocal, upgrade_db


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
    """Firm database (SQLite copy or pg_dump) and the judgment library, 14 of each kept, then a test restore of the
    firm backup so a broken backup is noticed the same night, not on the day it is needed."""
    from .dbtool import backup, verify_backup

    out_dir = Path(BACKUP_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    made = [str(backup(out_dir=str(out_dir)))]
    if Path(CORPUS_DB).exists():
        dst = out_dir / f"corpus-{stamp}.db"
        _sqlite_copy(CORPUS_DB, dst)
        made.append(str(dst))
    for old in sorted(out_dir.glob("corpus-*.db"))[:-14]:
        old.unlink()
    if made[0].endswith(".db") or os.environ.get("NYAAY_VERIFY_DATABASE_URL"):
        r = verify_backup(made[0])
        print("verify:", "ok" if r["ok"] else f"FAILED {r}")
        if not r["ok"]:
            raise SystemExit(1)
    for m in made:
        print("backup:", m)
    return made


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.jobs", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("job", choices=["brief", "sync", "backup"])
    a = ap.parse_args(argv)
    upgrade_db()
    {"brief": job_brief, "sync": job_sync, "backup": job_backup}[a.job]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
