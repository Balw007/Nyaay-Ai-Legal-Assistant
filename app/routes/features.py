"""Opposing-side check, client updates, hearing notes and route options for a matter."""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404, get_user, require_role
from ..models import Bookmark, Deadline, Matter, Note, Order, Task, User
from ..serializers import task_dict
from ..services import client_update as cu
from ..services import hearing_notes as hn
from ..services import opposing as opp
from ..services import playbook as pbk
from ..services import reviews as rv
from ..services import route_options as ro
from ..services.ai import firm_llm
from ..services.store import get_store

router = APIRouter(tags=["matter-tools"])


def _pb(m: Matter) -> dict:
    try:
        return pbk.get_playbook(m.case_type)
    except pbk.UnknownCaseType:
        raise HTTPException(422, f"No playbook for case type '{m.case_type}'")


# ------------------------------------------------------------------ opposing side

class OpposingIn(BaseModel):
    position: str = ""


@router.post("/matters/{matter_id}/opposing-check")
def opposing_check(matter_id: int, body: OpposingIn, db: Session = Depends(get_db),
                   user: User = Depends(get_user), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    saved = [{"jid": b.jid, "title": b.title, "citation": b.citation}
             for b in db.query(Bookmark).filter(Bookmark.matter_id == m.id, Bookmark.firm_id == firm_id)]
    position = body.position.strip()[:2000]
    res = opp.check(get_store(), firm_llm(db, firm_id, "opposing", user.id), position=position, saved=saved)
    res["saved_authorities"] = len(saved)
    audit(db, firm_id, user.email, "opposing_check", "matter", m.id, {"mode": res["mode"]})
    db.commit()
    return res


# ------------------------------------------------------------------ client updates

class ClientUpdateIn(BaseModel):
    language: str = "en"
    note: str = ""


@router.post("/matters/{matter_id}/client-update", status_code=201)
def client_update(matter_id: int, body: ClientUpdateIn, db: Session = Depends(get_db),
                  user: User = Depends(require_role("clerk")), firm_id: int = Depends(get_firm_id)):
    """Drafts the update and puts it in the approvals queue. It is never sent from here."""
    if body.language not in cu.LANGS:
        raise HTTPException(422, "language must be en, hi or mr")
    m = get_matter_or_404(db, firm_id, matter_id)
    pb = _pb(m)
    last = db.query(Order).filter(Order.matter_id == m.id).order_by(Order.id.desc()).first()
    stage = pbk.stage_by_id(pb, m.current_stage)
    dl = next((d for d in db.query(Deadline).filter(Deadline.matter_id == m.id, Deadline.due_date.isnot(None),
                                                    Deadline.due_date >= date.today()).order_by(Deadline.due_date)
               if not pbk.deadline_met(pb, d.rule_id, m.current_stage)), None)
    text = cu.build(body.language, client=m.client_name, title=m.title, court=m.court,
                    order_date=last.order_date if last else None, next_date=m.next_date,
                    stage=stage["name"] if stage else None, deadline=(dl.label, dl.due_date) if dl else None,
                    note=body.note[:600], advocate=user.name)
    t = Task(firm_id=firm_id, matter_id=m.id, source="client_update", action="client_update",
             title=f"Client update ({cu.LANGS[body.language]}) for {m.client_name or 'client'}",
             detail=text, payload={"language": body.language, "message": text})
    db.add(t)
    db.flush()
    audit(db, firm_id, user.email, "draft_client_update", "task", t.id, {"language": body.language})
    db.commit()
    return task_dict(t)


@router.get("/tasks/{task_id}/share")
def share_link(task_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    """WhatsApp link with the approved message prefilled. Only for approved client updates."""
    t = db.get(Task, task_id)
    if not t or t.firm_id != firm_id or t.action != "client_update":
        raise HTTPException(404, "Client update not found")
    if t.status not in ("approved", "done"):
        raise HTTPException(409, "Approve the update before sharing it")
    msg = (t.payload or {}).get("message") or t.detail
    return {"message": msg, "whatsapp_url": cu.whatsapp_link(msg)}


# ------------------------------------------------------------------ hearing notes

class HearingNotesIn(BaseModel):
    text: str
    hearing_date: Optional[date] = None


@router.post("/matters/{matter_id}/hearing-notes", status_code=201)
def hearing_notes(matter_id: int, body: HearingNotesIn, db: Session = Depends(get_db),
                  user: User = Depends(get_user), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    text = body.text.strip()
    if len(text) < 10:
        raise HTTPException(422, "Write a few lines about the hearing first")
    res = hn.extract(text[:8000], body.hearing_date, firm_llm(db, firm_id, "hearing_notes", user.id))
    when = f" ({body.hearing_date:%d %b %Y})" if body.hearing_date else ""
    note = Note(firm_id=firm_id, matter_id=m.id, body=f"Hearing note{when}\n{text}", author=user.name)
    db.add(note)
    existing = {t.title for t in db.query(Task).filter(Task.matter_id == m.id, Task.status == "proposed")}
    new: list[Task] = []

    def add(**kw):
        if kw["title"] in existing:
            return
        existing.add(kw["title"])
        new.append(Task(firm_id=firm_id, matter_id=m.id, source="hearing_note", **kw))

    nd = res["next_date"]
    if nd and nd != m.next_date:
        add(title=f"Set next hearing date to {nd:%d %b %Y}", due_date=nd, action="set_next_date",
            payload={"date": nd.isoformat()}, detail="Read from your hearing notes. Check the order before approving.")
    for t in res["tasks"]:
        add(title=t["title"], due_date=t["due_date"], detail="From your hearing notes.")
    db.add_all(new)
    db.flush()
    audit(db, firm_id, user.email, "hearing_notes", "matter", m.id, {"tasks": len(new), "method": res["method"]})
    db.commit()
    return {"note_id": note.id, "method": res["method"], "needs_review": res["needs_review"],
            "tasks": [task_dict(t) for t in new]}


# ------------------------------------------------------------------ goal and route options

def _review_map(db: Session, firm_id: int) -> dict:
    sm = rv.status_map(db, firm_id)
    return {ref: v["status"] for (kind, ref), v in sm.items() if kind == "route"}


@router.get("/matters/{matter_id}/routes")
def routes(matter_id: int, request: Request, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    """What-if: pass any playbook input as a query parameter (e.g. ?notice_received_date=2026-12-01)."""
    m = get_matter_or_404(db, firm_id, matter_id)
    pb = _pb(m)
    what_if = {}
    for k, v in request.query_params.items():
        if k in pbk.input_names(pb):
            try:
                what_if[k] = date.fromisoformat(v)
            except ValueError:
                raise HTTPException(422, f"{k} must be a date like 2026-12-01")
    return {"goal": m.goal, "route_id": (m.details or {}).get("route_id"),
            "inputs": [{"name": i["name"], "label": i["label"], "saved": (m.facts or {}).get(i["name"])}
                       for i in pb["inputs"]],
            "what_if": {k: v.isoformat() for k, v in what_if.items()},
            "note": pb.get("deadline_note", ""),
            "routes": ro.options(pb, m.facts or {}, what_if, _review_map(db, firm_id))}


class GoalIn(BaseModel):
    route_id: Optional[str] = None
    goal: Optional[str] = None


@router.put("/matters/{matter_id}/goal")
def set_goal(matter_id: int, body: GoalIn, db: Session = Depends(get_db),
             user: User = Depends(require_role("advocate")), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    pb = _pb(m)
    details = dict(m.details or {})
    if body.route_id:
        rt = next((r for r in pb.get("routes", []) if r["id"] == body.route_id), None)
        if not rt:
            raise HTTPException(404, "Unknown route")
        m.goal, details["route_id"] = rt["name"], rt["id"]
    elif body.goal is not None and body.goal.strip():
        m.goal = body.goal.strip()[:300]
        details.pop("route_id", None)
    else:
        raise HTTPException(422, "Give a route_id or a goal")
    m.details = details
    audit(db, firm_id, user.email, "set_goal", "matter", m.id, {"goal": m.goal, "route_id": details.get("route_id")})
    db.commit()
    draft = _review_map(db, firm_id).get(details.get("route_id", ""), "unreviewed") != "approved" \
        if details.get("route_id") else False
    return {"goal": m.goal, "route_id": details.get("route_id"), "draft": draft}
