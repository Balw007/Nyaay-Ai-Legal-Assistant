from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404
from ..models import Matter, Order, Task
from ..serializers import order_dict, task_dict
from ..services import playbook as pbk
from ..services.ai import firm_llm
from ..services.ocr import OCRUnavailable, UnsupportedFile, extract_text
from ..services.order_reader import read_order

router = APIRouter(tags=["orders"])


def propose_tasks(db: Session, firm_id: int, matter: Matter, order: Order, pb: dict, matched: list[str]) -> list[Task]:
    """Everything the AI wants to do goes in as 'proposed'. A lawyer approves each one."""
    existing = {t.title for t in db.query(Task).filter(Task.matter_id == matter.id, Task.status == "proposed")}
    new: list[Task] = []

    def add(**kw):
        if kw["title"] in existing:
            return
        existing.add(kw["title"])
        new.append(Task(firm_id=firm_id, matter_id=matter.id, **kw))

    if order.next_date:
        add(title=f"Set next hearing date to {order.next_date:%d %b %Y}", source="order", due_date=order.next_date,
            action="set_next_date", payload={"date": order.next_date.isoformat()},
            detail="Read from the order. Confirm against the order before approving.")
    stage = pbk.stage_by_id(pb, order.detected_stage)
    if stage and order.detected_stage != matter.current_stage and order.stage_confidence >= 0.45:
        add(title=f"Move case stage to '{stage['name']}'", source="order", action="set_stage",
            payload={"stage": stage["id"]}, detail=f"Matched in the order: {', '.join(matched)}")
    for d in order.directions[:5]:
        add(title=f"Comply with direction: {d[:180]}", detail=d, source="order", due_date=order.next_date)
    focus = stage or pbk.stage_by_id(pb, matter.current_stage)
    if focus:
        for a in focus["actions"][:3]:
            add(title=f"Suggested: {a}", source="playbook", due_date=order.next_date)
    if order.client_message:
        add(title="Send client update", detail=order.client_message, source="order")
    db.add_all(new)
    return new


@router.post("/matters/{matter_id}/orders", status_code=201)
async def upload_order(matter_id: int, text: Optional[str] = Form(None), file: Optional[UploadFile] = File(None),
                       language: str = Form("en"), db: Session = Depends(get_db),
                       firm_id: int = Depends(get_firm_id)):
    from ..services.order_intake import IntakeError, intake

    m = get_matter_or_404(db, firm_id, matter_id)
    if language not in {"en", "hi", "mr"}:
        raise HTTPException(422, "language must be en, hi or mr")
    data = await file.read() if file is not None and file.filename else None
    try:
        from starlette.concurrency import run_in_threadpool  # OCR / AI transcription can take a while

        r = await run_in_threadpool(intake, db, firm_id, m, text=text, data=data,
                                    filename=file.filename if data else None, language=language, source="upload")
    except IntakeError as exc:
        raise HTTPException(422, str(exc))
    return {"order": order_dict(r["order"]), "proposed_tasks": [task_dict(t) for t in r["tasks"]],
            "duplicate": r["duplicate"], "ocr": r.get("ocr")}


@router.get("/matters/{matter_id}/orders")
def list_orders(matter_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    rows = db.query(Order).filter(Order.matter_id == m.id).order_by(Order.id.desc()).all()
    return [order_dict(o) for o in rows]
