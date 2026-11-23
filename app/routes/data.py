"""Bare Acts, section tags, data quality and the gold set.

Everything that reads is open to any signed-in advocate or clerk; everything that changes the shared library needs the
admin role; the gold set is the firm's own and verifying needs an advocate (see services/gold.py)."""
from __future__ import annotations

import io
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_user, require_role
from ..models import GoldEntry, User
from ..services import acts as actsvc
from ..services import gold as goldsvc
from ..services import quality
from ..services.sections import ACTS
from ..services.store import get_store
from .library import _after_tag, _say, _start

router = APIRouter(tags=["data"])


def _code(code: str) -> str:
    if code not in ACTS:
        raise HTTPException(404, "Unknown Act")
    return code


# ------------------------------------------------------------------ Bare Acts

@router.get("/acts")
def acts_list(user: User = Depends(get_user)):
    return {"acts": actsvc.list_acts(get_store()), "catalog": sorted(actsvc.CATALOG)}


@router.get("/acts/search")
def acts_search(q: str = Query(..., min_length=1), act: Optional[str] = None, limit: int = Query(30, ge=1, le=100),
                user: User = Depends(get_user)):
    return {"query": q, "results": actsvc.search_sections(get_store(), q, act, limit)}


@router.get("/acts/{code}")
def act_detail(code: str, user: User = Depends(get_user)):
    a = actsvc.get_act(get_store(), _code(code))
    if not a:
        raise HTTPException(404, "This Act is not loaded yet. An admin can load it from the Bare Acts page.")
    return a


@router.get("/acts/{code}/{no}")
def act_section(code: str, no: str, user: User = Depends(get_user)):
    s = actsvc.get_section(get_store(), _code(code), no)
    if not s:
        raise HTTPException(404, "No such section in this Act")
    s["cases"] = actsvc.section_judgments(get_store(), code, no, 25)
    return s


class CatalogIn(BaseModel):
    codes: Optional[List[str]] = None


@router.post("/acts/import", status_code=202)
def acts_import(body: CatalogIn, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Download the catalogue Acts and the IPC->BNS style mappings from their public sources."""
    store = get_store()
    codes = body.codes
    if codes and any(c not in actsvc.CATALOG for c in codes):
        raise HTTPException(422, "Those Acts are not in the download catalogue. Use 'Upload official text'.")
    audit(db, user.firm_id, "advocate", "acts.import", "act", None, {"codes": codes or "all"})
    db.commit()

    def target():
        r = actsvc.import_catalog(store, codes, progress=_say)
        _say(f"Loaded {len(r['imported'])} Acts" + (f"; {len(r['failed'])} could not be loaded: {', '.join(r['failed'])}" if r["failed"] else ""))
        _after_tag(store)

    return _start("acts", "Bare Acts", target)


@router.post("/acts/upload")
async def acts_upload(code: str = Form(...), file: UploadFile = File(...), source_url: str = Form(""),
                      user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Official text of an Act (PDF or .txt from India Code, the Gazette or the Legislative Department)."""
    _code(code)
    raw = await file.read()
    name = file.filename or "act"
    if name.lower().endswith(".pdf"):
        from pypdf import PdfReader

        try:
            text = "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(raw)).pages)
        except Exception as exc:
            raise HTTPException(422, f"Could not read this PDF: {exc}")
    else:
        text = raw.decode("utf-8", errors="replace")
    try:
        rep = actsvc.import_official(get_store(), code, text, source_url, name)
    except actsvc.ActImportError as exc:
        raise HTTPException(422, str(exc))
    audit(db, user.firm_id, "advocate", "acts.upload", "act", None, {"code": code, "file": name, "sections": rep["count"]})
    db.commit()
    return rep


# ------------------------------------------------------------------ section tags

@router.get("/judgments/{jid}/sections")
def judgment_sections(jid: str, user: User = Depends(get_user)):
    if not get_store().get_judgment(jid):
        raise HTTPException(404, "Judgment not found")
    return get_store().judgment_sections(jid)


@router.get("/library/sections")
def section_facets(act: Optional[str] = None, limit: int = Query(40, ge=1, le=200), user: User = Depends(get_user)):
    return get_store().section_facets(act, limit)


@router.post("/library/retag", status_code=202)
def retag(everything: bool = False, user: User = Depends(require_role("admin"))):
    store = get_store()
    return _start("tag", "Section tagging", lambda: store.retag(progress=_say, everything=everything))


# ------------------------------------------------------------------ data quality

@router.get("/library/quality")
def quality_report(user: User = Depends(require_role("advocate"))):
    return quality.report(get_store())


@router.post("/library/quality/run", status_code=202)
def quality_run(user: User = Depends(require_role("admin"))):
    store = get_store()
    return _start("quality", "Checking data quality", lambda: quality.run(store, progress=_say))


@router.get("/library/quality/list")
def quality_list(issue: Optional[str] = None, max_score: Optional[int] = Query(None, ge=0, le=100),
                 limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                 user: User = Depends(require_role("advocate"))):
    try:
        return quality.list_judgments(get_store(), issue=issue, max_score=max_score, limit=limit, offset=offset)
    except ValueError:
        raise HTTPException(422, "Unknown issue")


@router.get("/library/quality/export.csv", response_class=PlainTextResponse)
def quality_export(issue: Optional[str] = None, max_score: Optional[int] = Query(None, ge=0, le=100),
                   user: User = Depends(require_role("advocate"))):
    return PlainTextResponse(quality.export_csv(get_store(), issue, max_score), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="nyaay-data-quality.csv"'})


@router.get("/library/quality/duplicates")
def quality_duplicates(user: User = Depends(require_role("advocate"))):
    return quality.duplicate_groups(get_store(), 100)


class MetaIn(BaseModel):
    title: Optional[str] = None
    court: Optional[str] = None
    decision_date: Optional[str] = None
    citations: Optional[List[str]] = None


@router.patch("/library/judgments/{jid}")
def fix_metadata(jid: str, body: MetaIn, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Correct a judgment's title, court, date or citations by hand. Recorded in the audit log."""
    store = get_store()
    fields = body.model_dump(exclude_none=True)
    try:
        changed = store.update_metadata(jid, fields)
    except KeyError:
        raise HTTPException(404, "Judgment not found")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    if changed:
        audit(db, user.firm_id, "advocate", "library.fix", "judgment", None,
              {"jid": jid, "changes": {k: {"from": v[0], "to": v[1]} for k, v in changed.items()}})
        db.commit()
    return {"changed": list(changed), "quality": quality.rescore(store, jid)}


# ------------------------------------------------------------------ gold set

class GoldAdd(BaseModel):
    jid: str
    topic: str = ""


class GoldPatch(BaseModel):
    topic: Optional[str] = None
    headnote: Optional[str] = None
    held: Optional[str] = None
    notes: Optional[str] = None
    issues: Optional[List[str]] = None
    key_paras: Optional[List[int]] = Field(None, max_length=60)


def _entry(db: Session, firm_id: int, eid: int) -> GoldEntry:
    e = db.get(GoldEntry, eid)
    if not e or e.firm_id != firm_id:
        raise HTTPException(404, "Gold entry not found")
    return e


@router.get("/gold")
def gold_list(status: Optional[str] = None, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id),
              user: User = Depends(get_user)):
    q = db.query(GoldEntry).filter(GoldEntry.firm_id == firm_id)
    if status:
        q = q.filter(GoldEntry.status == status)
    rows = q.order_by(GoldEntry.updated_at.desc()).all()
    return {"entries": [goldsvc.to_dict(e) for e in rows],
            "counts": {s: sum(1 for e in rows if e.status == s) for s in goldsvc.STATUSES}}


@router.get("/gold/suggest")
def gold_suggest(act: str = "ni", section: Optional[str] = "138", limit: int = Query(15, ge=1, le=50),
                 db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id), user: User = Depends(get_user)):
    have = [e.jid for e in db.query(GoldEntry).filter(GoldEntry.firm_id == firm_id)]
    return goldsvc.suggest(get_store(), _code(act), section or None, limit, have)


@router.get("/gold/benchmark")
def gold_benchmark(k: int = Query(10, ge=1, le=30), db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id),
                   user: User = Depends(require_role("advocate"))):
    rows = db.query(GoldEntry).filter(GoldEntry.firm_id == firm_id).all()
    return goldsvc.benchmark(get_store(), rows, k)


@router.get("/gold/export.csv", response_class=PlainTextResponse)
def gold_export(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id),
                user: User = Depends(require_role("advocate"))):
    rows = db.query(GoldEntry).filter(GoldEntry.firm_id == firm_id).order_by(GoldEntry.topic).all()
    return PlainTextResponse(goldsvc.export_csv(rows), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="nyaay-gold-set.csv"'})


@router.get("/gold/for/{jid}")
def gold_for(jid: str, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id), user: User = Depends(get_user)):
    e = db.query(GoldEntry).filter_by(firm_id=firm_id, jid=jid).first()
    return goldsvc.to_dict(e) if e else None


@router.post("/gold", status_code=201)
def gold_add(body: GoldAdd, db: Session = Depends(get_db), user: User = Depends(require_role("advocate"))):
    try:
        e = goldsvc.add(db, get_store(), user.firm_id, user, body.jid, body.topic)
    except goldsvc.GoldError as exc:
        raise HTTPException(409 if "already" in str(exc) else 422, str(exc))
    audit(db, user.firm_id, "advocate", "gold.add", "gold", e.id, {"jid": body.jid})
    db.commit()
    return goldsvc.to_dict(e)


@router.patch("/gold/{eid}")
def gold_patch(eid: int, body: GoldPatch, db: Session = Depends(get_db), user: User = Depends(require_role("advocate"))):
    e = _entry(db, user.firm_id, eid)
    was = e.status
    goldsvc.update(db, get_store(), e, body.model_dump(exclude_unset=True))
    if was == "verified" and e.status != "verified":
        audit(db, user.firm_id, "advocate", "gold.unverified_by_edit", "gold", e.id, {"jid": e.jid})
    db.commit()
    return goldsvc.to_dict(e)


@router.post("/gold/{eid}/verify")
def gold_verify(eid: int, db: Session = Depends(get_db), user: User = Depends(require_role("advocate"))):
    e = _entry(db, user.firm_id, eid)
    try:
        goldsvc.verify(e, get_store(), user)
    except goldsvc.GoldError as exc:
        raise HTTPException(422, str(exc))
    audit(db, user.firm_id, "advocate", "gold.verify", "gold", e.id, {"jid": e.jid, "enrolment": e.reviewer_enrolment})
    db.commit()
    return goldsvc.to_dict(e)


class RejectIn(BaseModel):
    note: str = ""


@router.post("/gold/{eid}/reject")
def gold_reject(eid: int, body: RejectIn, db: Session = Depends(get_db), user: User = Depends(require_role("advocate"))):
    e = _entry(db, user.firm_id, eid)
    try:
        goldsvc.reject(e, user, body.note)
    except goldsvc.GoldError as exc:
        raise HTTPException(422, str(exc))
    audit(db, user.firm_id, "advocate", "gold.reject", "gold", e.id, {"jid": e.jid})
    db.commit()
    return goldsvc.to_dict(e)


@router.delete("/gold/{eid}", status_code=204)
def gold_delete(eid: int, db: Session = Depends(get_db), user: User = Depends(require_role("admin"))):
    e = _entry(db, user.firm_id, eid)
    audit(db, user.firm_id, "advocate", "gold.delete", "gold", e.id, {"jid": e.jid, "status": e.status})
    db.delete(e)
    db.commit()
