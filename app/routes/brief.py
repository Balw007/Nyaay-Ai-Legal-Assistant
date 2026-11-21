from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_user
from ..models import User
from ..services import brief_delivery as bd
from ..services.brief import build_brief, render_text

router = APIRouter(tags=["brief"])


@router.get("/brief")
def brief(on: Optional[date] = None, format: str = "json", db: Session = Depends(get_db),
          firm_id: int = Depends(get_firm_id)):
    data = build_brief(db, firm_id, on or date.today())
    if format == "text":
        return PlainTextResponse(render_text(data))
    return data


class TestIn(BaseModel):
    channel: str = "all"  # telegram | whatsapp | all


@router.post("/brief/test")
def send_test(body: TestIn = TestIn(), user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Send today's real brief to you now, on the channel you choose, to check the connection."""
    if body.channel not in ("telegram", "whatsapp", "all"):
        raise HTTPException(422, "channel must be telegram, whatsapp or all")
    u = db.get(User, user.id)
    chosen = ["telegram", "whatsapp"] if body.channel == "all" else [body.channel]
    chosen = [c for c in chosen if (c == "telegram" and u.telegram_chat_id) or (c == "whatsapp" and u.phone)]
    if not chosen:
        raise HTTPException(409, "Add your Telegram chat or WhatsApp number in Settings first.")
    res = bd.deliver_to_user(db, u, bd.now_ist().date(), channels=chosen)
    audit(db, u.firm_id, u.email, "send_test_brief", "user", u.id, {"channels": chosen})
    db.commit()
    return {"results": res, "ok": any(r.get("ok") for r in res.values())}
