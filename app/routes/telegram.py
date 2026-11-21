"""Telegram connection for the morning brief: the firm's bot token (admin) and finding your own chat."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_user, require_role
from ..models import Firm, User
from ..services import telegram as tg

router = APIRouter(tags=["telegram"])


def _status(db: Session, user: User, bot: dict | None = None) -> dict:
    token, source = tg.token_for(db.get(Firm, user.firm_id))
    out = {"configured": bool(token), "source": source, "token_hint": tg.hint(token) if source == "firm" else None,
           "bot_username": None, "chat_id": user.telegram_chat_id, "brief": bool(user.telegram_brief)}
    if token:
        try:
            out["bot_username"] = (bot or tg.get_me(token)).get("username")
        except tg.TelegramError as exc:
            out["error"] = str(exc)
    return out


class TokenIn(BaseModel):
    bot_token: str


@router.get("/integrations/telegram")
def status(user: User = Depends(get_user), db: Session = Depends(get_db)):
    return _status(db, user)


@router.put("/integrations/telegram")
def set_token(body: TokenIn, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    token = body.bot_token.strip()
    if not tg.valid_token(token):
        raise HTTPException(422, "That does not look like a bot token. It looks like 123456789:AAH... and comes from @BotFather.")
    try:
        bot = tg.get_me(token)
    except tg.TelegramError as exc:
        raise HTTPException(422, f"Telegram did not accept this token: {exc}")
    f = db.get(Firm, user.firm_id)
    f.settings = {**(f.settings or {}), "telegram_bot_token": token}  # reassign so the JSON column is saved
    audit(db, f.id, user.email, "set_telegram_bot", "firm", f.id)
    db.commit()
    return _status(db, user, bot)


@router.delete("/integrations/telegram")
def remove_token(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    f = db.get(Firm, user.firm_id)
    f.settings = {k: v for k, v in (f.settings or {}).items() if k != "telegram_bot_token"}
    audit(db, f.id, user.email, "remove_telegram_bot", "firm", f.id)
    db.commit()
    return _status(db, user)


@router.get("/integrations/telegram/chats")
def chats(user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Recent private chats with the bot, so you can pick yours instead of typing an ID."""
    token, _ = tg.token_for(db.get(Firm, user.firm_id))
    if not token:
        raise HTTPException(409, "No Telegram bot is connected yet. An admin can add the bot token first.")
    try:
        return {"chats": tg.recent_chats(token)}
    except tg.TelegramError as exc:
        raise HTTPException(502, str(exc))
