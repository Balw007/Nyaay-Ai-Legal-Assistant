from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..config import WA_VERIFY_TOKEN
from ..db import get_db
from ..services import whatsapp as wa

router = APIRouter(tags=["whatsapp"])


@router.get("/webhooks/whatsapp")
def verify(request: Request):
    p = request.query_params
    if p.get("hub.mode") == "subscribe" and WA_VERIFY_TOKEN and p.get("hub.verify_token") == WA_VERIFY_TOKEN:
        return PlainTextResponse(p.get("hub.challenge", ""))
    raise HTTPException(403, "Verification failed")


@router.post("/webhooks/whatsapp")
async def receive(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    if not wa.verify_signature(body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "Bad signature")
    data = await request.json()
    from starlette.concurrency import run_in_threadpool

    n = 0
    for entry in data.get("entry", []):
        for ch in entry.get("changes", []):
            for msg in (ch.get("value") or {}).get("messages", []) or []:
                await run_in_threadpool(wa.handle_message, db, msg)
                n += 1
    return {"processed": n}
