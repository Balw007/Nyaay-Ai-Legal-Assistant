from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_user
from ..models import AgentTask, User, utcnow
from ..services import agents as ag
from ..services.ai import firm_llm

router = APIRouter(tags=["agents"])


class StartIn(BaseModel):
    agent: str
    input: dict = {}


@router.get("/agents")
def catalog(db: Session = Depends(get_db), user: User = Depends(get_user)):
    """What each agent does, what it runs on, and whether it can do its full job right now."""
    ai = firm_llm(db, user.firm_id, "answer", user.id).available
    out = []
    for key, c in ag.CATALOG.items():
        needs_ai_fully = key in ("judgment", "drafting")
        out.append({"id": key, **c, "ai_ready": ai,
                    "available": ai or not needs_ai_fully,
                    "mode": "full" if ai else ("unavailable" if needs_ai_fully else "reduced")})
    return out


@router.post("/agents/tasks", status_code=202)
def start(body: StartIn, db: Session = Depends(get_db), user: User = Depends(get_user)):
    try:
        t = ag.start(db, user, body.agent, body.input or {})
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return ag.task_dict(t)


@router.get("/agents/tasks")
def list_tasks(status: Optional[str] = None, agent: Optional[str] = None, limit: int = Query(30, ge=1, le=200),
               db: Session = Depends(get_db), user: User = Depends(get_user)):
    ag.recover(db)
    q = db.query(AgentTask).filter(AgentTask.firm_id == user.firm_id)
    if status == "active":
        q = q.filter(AgentTask.status.in_(("queued", "running")))
    elif status:
        q = q.filter(AgentTask.status == status)
    if agent:
        q = q.filter(AgentTask.agent == agent)
    return [ag.task_dict(t) for t in q.order_by(AgentTask.id.desc()).limit(limit).all()]


def _get(db: Session, firm_id: int, tid: int) -> AgentTask:
    t = db.get(AgentTask, tid)
    if not t or t.firm_id != firm_id:
        raise HTTPException(404, "Task not found")
    return t


@router.get("/agents/tasks/{tid}")
def get_task(tid: int, db: Session = Depends(get_db), user: User = Depends(get_user)):
    return ag.task_dict(_get(db, user.firm_id, tid))


@router.post("/agents/tasks/{tid}/cancel")
def cancel(tid: int, db: Session = Depends(get_db), user: User = Depends(get_user)):
    """Stops a queued task at once; a running task stops at its next step (a model call in progress finishes first)."""
    t = _get(db, user.firm_id, tid)
    if t.status not in ("queued", "running"):
        raise HTTPException(409, "This task has already finished")
    t.cancel_requested = True
    if t.status == "queued":
        t.status, t.finished_at, t.step = "cancelled", utcnow(), "Cancelled before it started"
    else:
        t.step = "Stopping after the current step"
    db.commit()
    return ag.task_dict(t)
