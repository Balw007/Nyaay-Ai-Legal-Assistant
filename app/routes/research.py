from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from sqlalchemy.orm import Session

from ..db import get_db
import hashlib
import json
from datetime import datetime, timedelta, timezone

from ..deps import get_firm_id, get_user
from ..models import AnswerCache, SearchHistory, User
from ..services import research as rs
from ..services.ai import firm_llm
from ..services.llm import get_llm
from ..services.store import get_store

router = APIRouter(tags=["research"])


class AskIn(BaseModel):
    question: str
    jid: Optional[str] = None
    court: Optional[str] = None
    year_from: Optional[int] = None
    year_to: Optional[int] = None


def _log(db: Session, firm_id: int, q: str, mode: str, results: Optional[int] = None,
         user_id: Optional[int] = None) -> None:
    try:
        db.add(SearchHistory(firm_id=firm_id, query=q.strip()[:500], mode=mode, results=results, user_id=user_id))
        db.commit()
    except Exception:
        db.rollback()


@router.get("/research/stats")
def stats(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    s = get_store().stats()
    s["llm"] = firm_llm(db, firm_id, "answer").name
    return s


@router.get("/research/search")
def search(q: str = Query(..., min_length=2), court: Optional[str] = None, year_from: Optional[int] = None,
           year_to: Optional[int] = None, limit: int = Query(10, ge=1, le=50), offset: int = Query(0, ge=0),
           act: Optional[str] = None, section: Optional[str] = None,
           db: Session = Depends(get_db), user: User = Depends(get_user)):
    out = get_store().search(q, court=court, year_from=year_from, year_to=year_to, limit=limit, offset=offset,
                             act=act or None, section=section or None)
    if offset == 0:
        _log(db, user.firm_id, q, "search", out["total"], user.id)
    return out


@router.post("/research/ask")
def ask(body: AskIn, db: Session = Depends(get_db), user: User = Depends(get_user)):
    if len(body.question.strip()) < 5:
        raise HTTPException(422, "Ask a full question")
    firm_id = user.firm_id
    store = get_store()
    # Same question, same filters, same library -> same answer for 7 days, at no AI cost.
    key = hashlib.sha256(json.dumps([" ".join(body.question.lower().split()), body.jid, body.court, body.year_from,
                                     body.year_to, store.stats()["paragraphs"]]).encode()).hexdigest()
    week = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    hit = db.query(AnswerCache).filter(AnswerCache.firm_id == firm_id, AnswerCache.key == key,
                                       AnswerCache.created_at >= week).first()
    if hit:
        out = dict(hit.payload, cached=True)
    else:
        out = rs.ask(store, firm_llm(db, firm_id, "answer", user.id), body.question, jid=body.jid, court=body.court,
                     year_from=body.year_from, year_to=body.year_to)
        if out.get("mode") == "answer":
            db.add(AnswerCache(firm_id=firm_id, key=key, payload=out))
            db.commit()
    if not body.jid:
        _log(db, firm_id, body.question, "ask", len(out.get("sources") or []), user.id)
    return out


@router.get("/judgments/{jid}")
def judgment(jid: str):
    j = get_store().get_judgment(jid)
    if not j:
        raise HTTPException(404, "Judgment not found")
    j.pop("summary", None)
    return j


@router.get("/judgments/{jid}/links")
def links(jid: str):
    if not get_store().get_judgment(jid):
        raise HTTPException(404, "Judgment not found")
    return get_store().links(jid)


@router.post("/judgments/{jid}/summary")
def summary(jid: str, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    out = rs.summarize(get_store(), firm_llm(db, firm_id, "summary"), jid)
    if out.get("mode") == "not_found":
        raise HTTPException(404, "Judgment not found")
    return out
