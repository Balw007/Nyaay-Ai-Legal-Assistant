"""Send the morning brief on the channels each person switched on (Telegram, WhatsApp), once a day.

The in-app scheduler calls deliver_due() every minute; it only acts from the brief hour (8 am IST by default) and
at most once per person per day. `python -m app.jobs brief` does the same from cron when the app is not running
all day. Nothing is sent to anyone who has not opted in."""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..config import BRIEF_HOUR_IST
from ..models import Firm, User
from . import telegram as tg
from . import whatsapp as wa
from .brief import build_brief, render_text

IST = timezone(timedelta(hours=5, minutes=30))
WINDOW_HOURS = 4          # still send up to four hours late (the computer may start at 9), never in the afternoon
RETRY_AFTER_S = 600       # a failing channel is retried every ten minutes, a few times
MAX_TRIES = 4
_tries: dict = {}


def now_ist(now: Optional[datetime] = None) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(IST)


def wants(u: User) -> list:
    out = []
    if u.telegram_brief and u.telegram_chat_id:
        out.append("telegram")
    if u.whatsapp_brief and u.phone:
        out.append("whatsapp")
    return out


def _send_telegram(db: Session, u: User, text: str, client=None) -> dict:
    token, _ = tg.token_for(db.get(Firm, u.firm_id))
    if not token:
        return {"skipped": "No Telegram bot connected"}
    if not u.telegram_chat_id:
        return {"skipped": "No Telegram chat chosen"}
    try:
        return tg.send_message(token, u.telegram_chat_id, text, client=client)
    except tg.TelegramError as exc:
        return {"error": str(exc)}


def _send_whatsapp(u: User, text: str, client=None) -> dict:
    if not u.phone:
        return {"skipped": "No WhatsApp number"}
    try:
        r = wa.send_brief_template(u.phone, text, client=client)
    except Exception as exc:  # network or API trouble must not stop the other channel
        return {"error": f"WhatsApp failed ({type(exc).__name__})"}
    if r.get("skipped"):
        return {"skipped": r["skipped"]}
    if r.get("error"):
        return {"error": str((r["error"] or {}).get("message") or "WhatsApp refused the message")[:200]}
    return {"ok": True}


def deliver_to_user(db: Session, u: User, today: date, channels: Optional[list] = None,
                    tg_client=None, wa_client=None) -> dict:
    """Send today's brief to one person. channels=None means the ones they switched on."""
    channels = channels if channels is not None else wants(u)
    if not channels:
        return {}
    text = render_text(build_brief(db, u.firm_id, today))
    res = {}
    for ch in channels:
        res[ch] = _send_telegram(db, u, text, tg_client) if ch == "telegram" else _send_whatsapp(u, text, wa_client)
    return res


def deliver_due(db: Session, now: Optional[datetime] = None, respect_hour: bool = True,
                tg_client=None, wa_client=None) -> int:
    """Brief everyone who is due. Returns how many people received at least one message."""
    local = now_ist(now)
    if respect_hour and not (BRIEF_HOUR_IST <= local.hour < BRIEF_HOUR_IST + WINDOW_HOURS):
        return 0
    today, sent = local.date(), 0
    for u in db.query(User).filter(User.active.is_(True)).all():
        if u.last_brief_on == today or not wants(u):
            continue
        key = (u.id, today)
        n, last = _tries.get(key, (0, 0.0))
        if n >= MAX_TRIES or (n and time.time() - last < RETRY_AFTER_S):
            continue
        res = deliver_to_user(db, u, today, tg_client=tg_client, wa_client=wa_client)
        if any(r.get("ok") for r in res.values()):
            u.last_brief_on = today
            db.commit()
            sent += 1
        else:
            _tries[key] = (n + 1, time.time())
        for ch, r in res.items():
            print(f"brief {u.email} {ch}: {r.get('error') or r.get('skipped') or 'sent'}")
    return sent
