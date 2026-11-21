from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404
from ..models import Deadline, Matter, Order, Task
from ..serializers import deadline_dict, matter_dict, order_dict, task_dict
from ..services import deadlines as dl_service
from ..services import playbook as pbk

router = APIRouter(tags=["matters"])


class MatterIn(BaseModel):
    title: str
    case_type: str = "ni138"
    court: Optional[str] = None
    case_number: Optional[str] = None
    cnr: Optional[str] = None
    client_name: Optional[str] = None
    goal: Optional[str] = None


class FactsIn(BaseModel):
    facts: dict[str, date]


def _playbook_or_422(case_type: str) -> dict:
    try:
        return pbk.get_playbook(case_type)
    except pbk.UnknownCaseType:
        raise HTTPException(422, f"Unknown case type '{case_type}'. Available: {pbk.available_case_types()}")


@router.get("/playbooks/{case_type}")
def playbook_info(case_type: str):
    pb = _playbook_or_422(case_type)
    return {"case_type": pb["case_type"], "name": pb["name"], "version": pb["version"], "status": pb["status"],
            "inputs": pb["inputs"], "stages": [{"id": s["id"], "name": s["name"]} for s in pb["stages"]]}


@router.post("/matters", status_code=201)
def create_matter(body: MatterIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    _playbook_or_422(body.case_type)
    m = Matter(firm_id=firm_id, **body.model_dump())
    db.add(m)
    db.flush()
    audit(db, firm_id, "advocate", "create", "matter", m.id, {"title": m.title})
    db.commit()
    return matter_dict(m)


@router.get("/matters")
def list_matters(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    rows = db.query(Matter).filter(Matter.firm_id == firm_id).order_by(Matter.id.desc()).all()
    return [matter_dict(m) for m in rows]


@router.get("/matters/{matter_id}")
def matter_detail(matter_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    pb = _playbook_or_422(m.case_type)
    deadlines = db.query(Deadline).filter(Deadline.matter_id == m.id).order_by(Deadline.due_date).all()
    tasks = db.query(Task).filter(Task.matter_id == m.id).order_by(Task.id.desc()).limit(50).all()
    orders = db.query(Order).filter(Order.matter_id == m.id).order_by(Order.id.desc()).limit(20).all()
    from ..services.reviews import status_map
    rev = status_map(db, firm_id)
    return {"matter": matter_dict(m), "plan": pbk.plan(pb, m.current_stage),
            "deadlines": [dict(deadline_dict(d), met=pbk.deadline_met(pb, d.rule_id, m.current_stage),
                               review=rev.get(("rule", d.rule_id), {}).get("status", "unreviewed")) for d in deadlines],
            "tasks": [task_dict(t) for t in tasks], "orders": [order_dict(o) for o in orders]}


@router.put("/matters/{matter_id}/facts")
def set_facts(matter_id: int, body: FactsIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    """Lawyer-confirmed dates. Deadlines are recomputed from these by fixed rules."""
    m = get_matter_or_404(db, firm_id, matter_id)
    pb = _playbook_or_422(m.case_type)
    unknown = set(body.facts) - pbk.input_names(pb)
    if unknown:
        raise HTTPException(422, f"Unknown fact(s): {sorted(unknown)}. Allowed: {sorted(pbk.input_names(pb))}")

    merged = dict(m.facts or {})
    merged.update({k: v.isoformat() for k, v in body.facts.items()})
    m.facts = merged  # reassign so the JSON column is saved

    db.flush()
    rows = dl_service.recompute(db, m)
    audit(db, firm_id, "advocate", "set_facts", "matter", m.id, {k: v.isoformat() for k, v in body.facts.items()})
    db.commit()
    return {"facts": m.facts, "deadlines": [deadline_dict(d) for d in rows]}


@router.get("/matters/{matter_id}/deadlines")
def get_deadlines(matter_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    rows = db.query(Deadline).filter(Deadline.matter_id == m.id).order_by(Deadline.due_date).all()
    return [deadline_dict(d) for d in rows]
