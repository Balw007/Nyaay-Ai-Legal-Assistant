from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, require_role
from ..models import AuditLog, Matter, Task, User
from ..serializers import task_dict

router = APIRouter(tags=["tasks"])


class Decision(BaseModel):
    actor: str = "advocate"


def _get_task(db: Session, firm_id: int, task_id: int) -> Task:
    t = db.get(Task, task_id)
    if not t or t.firm_id != firm_id:
        raise HTTPException(404, "Task not found")
    return t


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/tasks")
def list_tasks(status: Optional[str] = None, matter_id: Optional[int] = None, db: Session = Depends(get_db),
               firm_id: int = Depends(get_firm_id)):
    q = db.query(Task).filter(Task.firm_id == firm_id)
    if status:
        q = q.filter(Task.status == status)
    if matter_id:
        q = q.filter(Task.matter_id == matter_id)
    return [task_dict(t) for t in q.order_by(Task.id.desc()).limit(200)]


def _approve(db: Session, firm_id: int, user: User, t: Task) -> None:
    if t.status != "proposed":
        raise HTTPException(409, f"Task is already {t.status}")
    m = db.get(Matter, t.matter_id)
    if t.action == "set_next_date":
        m.next_date = date.fromisoformat(t.payload["date"])
    elif t.action == "set_stage":
        m.current_stage = t.payload["stage"]
    t.status, t.decided_by, t.decided_at = "approved", user.email, _now()
    audit(db, firm_id, user.email, "approve", "task", t.id,
          {"action": t.action, "payload": t.payload if t.action != "client_update" else {"language": t.payload.get("language")}})


def _reject(db: Session, firm_id: int, user: User, t: Task) -> None:
    if t.status != "proposed":
        raise HTTPException(409, f"Task is already {t.status}")
    t.status, t.decided_by, t.decided_at = "rejected", user.email, _now()
    audit(db, firm_id, user.email, "reject", "task", t.id)


@router.post("/tasks/{task_id}/approve")
def approve(task_id: int, body: Decision = Decision(), db: Session = Depends(get_db),
            user: User = Depends(require_role("advocate")), firm_id: int = Depends(get_firm_id)):
    t = _get_task(db, firm_id, task_id)
    _approve(db, firm_id, user, t)
    db.commit()
    return task_dict(t)


@router.post("/tasks/{task_id}/reject")
def reject(task_id: int, body: Decision = Decision(), db: Session = Depends(get_db),
           user: User = Depends(require_role("advocate")), firm_id: int = Depends(get_firm_id)):
    t = _get_task(db, firm_id, task_id)
    _reject(db, firm_id, user, t)
    db.commit()
    return task_dict(t)


class TaskPatch(BaseModel):
    title: Optional[str] = None
    detail: Optional[str] = None
    due_date: Optional[date] = None


@router.patch("/tasks/{task_id}")
def edit_task(task_id: int, body: TaskPatch, db: Session = Depends(get_db),
              user: User = Depends(require_role("advocate")), firm_id: int = Depends(get_firm_id)):
    """Edit a proposed task before deciding on it. A client update's message is its detail text."""
    t = _get_task(db, firm_id, task_id)
    if t.status != "proposed":
        raise HTTPException(409, "Only proposed tasks can be edited")
    if body.title is not None and body.title.strip():
        t.title = body.title.strip()[:500]
    if body.detail is not None:
        t.detail = body.detail
        if t.action == "client_update":
            t.payload = {**(t.payload or {}), "message": body.detail}
    if body.due_date is not None and t.action not in ("set_next_date", "set_stage"):
        t.due_date = body.due_date
    audit(db, firm_id, user.email, "edit_task", "task", t.id)
    db.commit()
    return task_dict(t)


# ------------------------------------------------------------------ daily approvals queue

KIND = {"set_next_date": "date change", "set_stage": "stage change", "client_update": "client message"}


def _kind(t: Task) -> str:
    return KIND.get(t.action or "", "to-do")


def _conflicts(tasks: list) -> dict:
    """task id -> reason, for several proposals that would set the same thing on one matter."""
    seen: dict = {}
    for t in tasks:
        if t.action in ("set_next_date", "set_stage"):
            seen.setdefault((t.matter_id, t.action), []).append(t)
    out = {}
    for (_, action), ts in seen.items():
        if len(ts) > 1:
            for t in ts:
                out[t.id] = f"{len(ts)} proposals would each change the {'next date' if action == 'set_next_date' else 'stage'}. Approve one at a time."
    return out


def _summary(tasks: list, matters: int) -> str:
    if not tasks:
        return "Nothing is waiting for your decision."
    counts: dict = {}
    for t in tasks:
        counts[_kind(t)] = counts.get(_kind(t), 0) + 1
    parts = ", ".join(f"{n} {k}{'s' if n > 1 else ''}" for k, n in sorted(counts.items(), key=lambda kv: -kv[1]))
    return f"{len(tasks)} waiting across {matters} matter{'s' if matters != 1 else ''}: {parts}."


@router.get("/approvals/queue")
def approvals_queue(matter_id: Optional[int] = None, db: Session = Depends(get_db),
                    firm_id: int = Depends(get_firm_id)):
    q = db.query(Task).filter(Task.firm_id == firm_id, Task.status == "proposed")
    if matter_id:
        q = q.filter(Task.matter_id == matter_id)
    tasks = q.order_by(Task.matter_id, Task.id).limit(500).all()
    conflicts = _conflicts(tasks)
    ms = {m.id: m for m in db.query(Matter).filter(Matter.id.in_({t.matter_id for t in tasks} or {0}))}
    groups: dict = {}
    for t in tasks:
        m = ms.get(t.matter_id)
        g = groups.setdefault(t.matter_id, {"matter": {"id": t.matter_id, "title": m.title if m else "",
                                                       "client_name": m.client_name if m else None,
                                                       "next_date": m.next_date.isoformat() if m and m.next_date else None},
                                            "tasks": []})
        # "safe" = adds a to-do only: no date, stage or message goes anywhere on approval
        g["tasks"].append({**task_dict(t), "kind": _kind(t), "safe": t.action is None,
                           "conflict": conflicts.get(t.id)})
    return {"total": len(tasks), "summary": _summary(tasks, len(groups)),
            "safe_ids": [t.id for t in tasks if t.action is None and t.id not in conflicts],
            "groups": list(groups.values())}


class BatchIn(BaseModel):
    ids: list[int]
    decision: str  # approve | reject


@router.post("/tasks/batch")
def batch(body: BatchIn, db: Session = Depends(get_db), user: User = Depends(require_role("advocate")),
          firm_id: int = Depends(get_firm_id)):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(422, "decision must be approve or reject")
    ids = list(dict.fromkeys(body.ids))[:200]
    if not ids:
        raise HTTPException(422, "Select at least one task")
    rows = {t.id: t for t in db.query(Task).filter(Task.firm_id == firm_id, Task.id.in_(ids))}
    conflicts = _conflicts([t for t in rows.values() if t.status == "proposed"]) if body.decision == "approve" else {}
    done, skipped = [], []
    for i in ids:
        t = rows.get(i)
        if not t:
            skipped.append({"id": i, "reason": "Not found"})
        elif t.id in conflicts:
            skipped.append({"id": i, "reason": conflicts[t.id]})
        else:
            try:
                (_approve if body.decision == "approve" else _reject)(db, firm_id, user, t)
                done.append(task_dict(t))
            except HTTPException as e:
                skipped.append({"id": i, "reason": e.detail})
    audit(db, firm_id, user.email, f"batch_{body.decision}", "task", None,
          {"done": [d["id"] for d in done], "skipped": [s["id"] for s in skipped]})
    db.commit()
    return {"decision": body.decision, "done": done, "skipped": skipped}


@router.get("/approvals/log")
def approvals_log(limit: int = 100, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    acts = ["approve", "reject", "done", "batch_approve", "batch_reject", "edit_task", "draft_client_update"]
    rows = (db.query(AuditLog).filter(AuditLog.firm_id == firm_id, AuditLog.action.in_(acts))
            .order_by(AuditLog.id.desc()).limit(max(1, min(limit, 300))).all())
    tids = {r.object_id for r in rows if r.object_type == "task" and r.object_id}
    ts = {t.id: t for t in db.query(Task).filter(Task.id.in_(tids or {0}), Task.firm_id == firm_id)}
    mids = {t.matter_id for t in ts.values()}
    ms = {m.id: m.title for m in db.query(Matter).filter(Matter.id.in_(mids or {0}))}
    out = []
    for r in rows:
        t = ts.get(r.object_id) if r.object_id else None
        out.append({"id": r.id, "at": r.created_at.isoformat(), "actor": r.actor, "action": r.action,
                    "task_id": r.object_id, "title": t.title if t else None,
                    "matter": ms.get(t.matter_id) if t else None,
                    "count": len((r.detail or {}).get("done", [])) if r.action.startswith("batch_") else None})
    return out


@router.post("/tasks/{task_id}/done")
def done(task_id: int, body: Decision = Decision(), db: Session = Depends(get_db),
        user: User = Depends(require_role("clerk")),
         firm_id: int = Depends(get_firm_id)):
    t = _get_task(db, firm_id, task_id)
    if t.status != "approved":
        raise HTTPException(409, "Only approved tasks can be marked done")
    t.status = "done"
    audit(db, firm_id, user.email, "done", "task", t.id)
    db.commit()
    return task_dict(t)
