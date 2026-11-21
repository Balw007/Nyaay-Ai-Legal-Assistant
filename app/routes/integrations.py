"""eCourts sync and integration status."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404, require_role
from ..models import Matter, Task, User
from ..serializers import matter_dict
from ..services import ecourts, indiankanoon, vectors
from ..services.order_intake import IntakeError, intake
from ..services.store import get_store

router = APIRouter(tags=["integrations"])


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def sync_matter(db: Session, m: Matter, client=None) -> dict:
    """Pull the case from eCourts. New orders are read; a changed next date becomes a PROPOSED task."""
    if not m.cnr:
        raise ecourts.EcourtsError("Add the 16-character CNR to this matter first.")
    payload = ecourts.fetch_case(m.cnr, client=client)
    info = ecourts.parse_case(payload)
    new_orders, proposed = 0, 0
    for text in info["orders"][-10:]:
        try:
            r = intake(db, m.firm_id, m, text=text, source="ecourts")
        except IntakeError:
            continue
        if not r["duplicate"]:
            new_orders += 1
            proposed += len(r["tasks"])
    if info["next_date"] and info["next_date"] != m.next_date:
        title = f"Set next hearing date to {info['next_date']:%d %b %Y} (from eCourts)"
        same = [t for t in db.query(Task).filter(Task.matter_id == m.id, Task.status == "proposed",
                                                 Task.action == "set_next_date")
                if (t.payload or {}).get("date") == info["next_date"].isoformat()]
        if not same:
            db.add(Task(firm_id=m.firm_id, matter_id=m.id, title=title, source="ecourts", due_date=info["next_date"],
                        action="set_next_date", payload={"date": info["next_date"].isoformat()},
                        detail="Reported by eCourts. Confirm on the court's cause list before approving."))
            proposed += 1
    m.synced_at = _now()
    m.sync_status = (f"OK · status: {info['status'] or 'n/a'} · next date: "
                     f"{info['next_date'].isoformat() if info['next_date'] else 'not reported'}")[:300]
    audit(db, m.firm_id, "system", "ecourts_sync", "matter", m.id, {"new_orders": new_orders, "proposed": proposed})
    db.commit()
    return {"new_orders": new_orders, "proposed_tasks": proposed, "next_date": info["next_date"].isoformat()
            if info["next_date"] else None, "status": info["status"]}


@router.post("/matters/{matter_id}/sync")
def sync_one(matter_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    try:
        r = sync_matter(db, m)
    except ecourts.EcourtsError as exc:
        m.sync_status = f"Failed: {exc}"[:300]
        db.commit()
        raise HTTPException(422, str(exc))
    except Exception as exc:
        m.sync_status = f"Failed: {type(exc).__name__}"[:300]
        db.commit()
        raise HTTPException(502, f"eCourts sync failed ({type(exc).__name__}). Try again later.")
    return {**r, "matter": matter_dict(m)}


@router.post("/sync/all")
def sync_all(user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    if not ecourts.available():
        raise HTTPException(409, "eCourts sync is not configured (ECOURTSINDIA_TOKEN).")
    out = {"synced": 0, "failed": 0, "new_orders": 0, "proposed_tasks": 0}
    for m in db.query(Matter).filter(Matter.firm_id == user.firm_id, Matter.status == "active", Matter.cnr.isnot(None)):
        try:
            r = sync_matter(db, m)
            out["synced"] += 1
            out["new_orders"] += r["new_orders"]
            out["proposed_tasks"] += r["proposed_tasks"]
        except Exception as exc:
            m.sync_status = f"Failed: {exc}"[:300]
            db.commit()
            out["failed"] += 1
    return out


@router.get("/integrations")
def integrations(firm_id: int = Depends(get_firm_id)):
    from ..config import WA_PHONE_ID, WA_TOKEN
    v = vectors.status(get_store())
    return {"ecourts": ecourts.available(), "indiankanoon": indiankanoon.available(),
            "whatsapp": bool(WA_TOKEN and WA_PHONE_ID), "semantic_search": v}
