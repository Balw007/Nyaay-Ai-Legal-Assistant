"""Library: load real judgments from inside the app, with live progress.

Runs the same pipelines as `python -m app.ingest` in a background thread, one job at a time. Work is done in
chunks of 100 judgments so a job can be stopped cleanly and resumed later (already-loaded judgments are skipped).
"""
from __future__ import annotations

import shutil
import tempfile
import threading
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from .. import ingest as ing
from ..db import get_db
from ..deps import require_role
from ..models import User
from ..services import vectors
from ..services.llm import llm_status
from ..services.store import get_store

from ..services.ocr import engine_status as ocr_status  # noqa: E402

router = APIRouter(tags=["library"])

CHUNK = 100
_lock = threading.Lock()
_stop = threading.Event()
JOB: dict = {"state": "idle", "kind": None, "label": "", "started_at": None, "finished_at": None, "added": 0,
             "failed": 0, "duplicates": 0, "error": None, "log": deque(maxlen=300)}


def _say(msg: str) -> None:
    JOB["log"].append(f"{datetime.now().strftime('%H:%M:%S')}  {msg}")


def _public_job() -> dict:
    j = dict(JOB)
    j["log"] = list(JOB["log"])[-80:]
    return j


def _start(kind: str, label: str, target) -> dict:
    with _lock:
        if JOB["state"] == "running":
            raise HTTPException(409, "A library job is already running. Stop it or wait for it to finish.")
        _stop.clear()
        JOB.update(state="running", kind=kind, label=label, started_at=datetime.now().isoformat(timespec="seconds"),
                   finished_at=None, added=0, failed=0, duplicates=0, error=None)
        JOB["log"].clear()

    def run():
        try:
            target()
            JOB["state"] = "stopped" if _stop.is_set() else "done"
        except ing.FetchError as exc:
            JOB.update(state="failed", error=f"Could not reach the open dataset ({exc}). Check the internet "
                                             "connection and try again; finished judgments are kept.")
        except Exception as exc:  # pragma: no cover - surfaced to the user
            JOB.update(state="failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            JOB["finished_at"] = datetime.now().isoformat(timespec="seconds")
            _say(f"Finished: {JOB['state']}. Added {JOB['added']} judgments.")

    threading.Thread(target=run, daemon=True, name=f"library-{kind}").start()
    return _public_job()


def _after_load(store) -> None:
    if JOB["added"] and not _stop.is_set():
        _say("Linking citations between judgments (citator)…")
        store.reindex_citator(lambda m: None)
        if vectors.get_embedder() is not None:
            _say("Building search-by-meaning vectors…")
            vectors.build(store, progress=_say)


def _after_tag(store) -> None:
    """Tag judgments that have not been tagged with the Acts and sections they discuss."""
    if not _stop.is_set():
        _say("Tagging judgments with the Acts and sections they discuss…")
        store.retag(progress=_say)


def _chunked(run_chunk) -> None:
    """Call run_chunk(limit) until nothing new is processed or the user stops the job."""
    while not _stop.is_set():
        s = run_chunk(CHUNK)
        JOB["added"] += s.get("added", 0)
        JOB["failed"] += s.get("failed", 0)
        JOB["duplicates"] = JOB.get("duplicates", 0) + s.get("duplicates", 0)
        # Stored, duplicate and scanned judgments are remembered, so the next chunk moves on. A chunk of only
        # failures (network trouble) would repeat itself, so stop and let the user retry later.
        if s.get("added", 0) + s.get("duplicates", 0) + s.get("scanned_or_empty", 0) == 0:
            break


class LoadIn(BaseModel):
    source: str = Field(pattern="^(sc|hc)$")
    years: List[int] = Field(min_length=1, max_length=40)
    courts: List[str] = []
    workers: int = Field(4, ge=1, le=8)


@router.get("/library/status")
def status(user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    from .admin import example_counts
    store = get_store()
    return {"corpus": store.stats(), "job": _public_job(), "ai": llm_status(), "semantic": vectors.status(store),
            "example_data": example_counts(db, user.firm_id), "quality": store.quality_report(),
            "ocr": {**ocr_status(), "bulk": ing.OCR_BULK}}


@router.post("/library/load", status_code=202)
def load(body: LoadIn, user: User = Depends(require_role("admin"))):
    store = get_store()
    years = sorted(set(y for y in body.years if 1950 <= y <= datetime.now().year), reverse=True)
    if not years:
        raise HTTPException(422, "Choose years between 1950 and this year.")
    if body.source == "sc":
        label = f"Supreme Court {years[-1]}–{years[0]}" if len(years) > 1 else f"Supreme Court {years[0]}"

        def target():
            for y in years:
                if _stop.is_set():
                    break
                _say(f"Supreme Court {y}: listing judgments…")
                _chunked(lambda n, y=y: ing.ingest_year(store, y, limit=n, workers=body.workers, progress=_say))
            _after_load(store)
    else:
        courts = body.courts or ["27_1"]
        names = dict(ing.HC_NAMES)
        label = f"High Court ({', '.join(names.get(c, c) for c in courts)}) {', '.join(map(str, years))}"

        def target():
            try:
                names.update(ing.hc_court_names())
            except Exception:
                pass
            for y in years:
                for c in courts:
                    if _stop.is_set():
                        break
                    _say(f"{names.get(c, c)} {y}: listing judgments…")
                    try:
                        _chunked(lambda n, y=y, c=c: ing.ingest_hc(store, y, c, limit=n, workers=body.workers,
                                                                   progress=_say, names=names))
                    except ing.FetchError as exc:
                        _say(f"Skipped {names.get(c, c)} {y}: {exc}")
            _after_load(store)
    return _start(body.source, label, target)


@router.post("/library/embed", status_code=202)
def embed(user: User = Depends(require_role("admin"))):
    if vectors.get_embedder() is None:
        raise HTTPException(409, "Search by meaning needs Ollama with nomic-embed-text: run 'ollama pull nomic-embed-text'.")
    store = get_store()
    return _start("embed", "Search-by-meaning vectors", lambda: JOB.update(added=0) or vectors.build(store, progress=_say))


@router.post("/library/upload", status_code=202)
async def upload(files: List[UploadFile] = File(...), user: User = Depends(require_role("admin"))):
    """Your own judgment PDFs or text files (e.g. from your chambers' collection)."""
    if not files or len(files) > 200:
        raise HTTPException(422, "Upload between 1 and 200 files.")
    folder = Path(tempfile.mkdtemp(prefix="nyaai-upload-"))
    for f in files:
        name = Path(f.filename or "judgment.pdf").name
        if not name.lower().endswith((".pdf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff")):
            continue
        (folder / name).write_bytes(await f.read())
    store = get_store()

    def target():
        try:
            s = ing.ingest_files(store, str(folder), progress=_say)
            JOB["added"], JOB["failed"] = s.get("added", 0), s.get("failed", 0)
            JOB["duplicates"] = s.get("duplicates", 0)
            store.resolve_parallel()
            _after_load(store)
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    return _start("files", f"{len(files)} uploaded file(s)", target)


@router.post("/library/stop")
def stop(user: User = Depends(require_role("admin"))):
    if JOB["state"] != "running":
        return _public_job()
    _stop.set()
    _say("Stopping after the current batch…")
    return _public_job()


@router.get("/library/hc-courts")
def hc_courts(user: User = Depends(require_role("advocate"))):
    try:
        names = ing.hc_court_names()
    except Exception:
        names = dict(ing.HC_NAMES)
    return [{"code": k, "name": v} for k, v in sorted(names.items(), key=lambda kv: kv[1])]
