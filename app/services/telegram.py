"""Telegram Bot API, used for the morning brief.

Setup is two steps: create a bot with @BotFather and paste its token in Settings; then each advocate opens the bot,
presses Start, and picks their chat in Settings. Errors never include the token (it is part of the URL)."""
from __future__ import annotations

import re
from typing import Optional

from ..config import TELEGRAM_BOT_TOKEN
from ..models import Firm

API = "https://api.telegram.org"
LIMIT = 4000  # Telegram allows 4096 characters per message
TOKEN_RE = re.compile(r"^\d{5,15}:[A-Za-z0-9_-]{30,60}$")
CHAT_RE = re.compile(r"^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,})$")


class TelegramError(RuntimeError):
    pass


def valid_token(token: str) -> bool:
    return bool(TOKEN_RE.match((token or "").strip()))


def valid_chat(chat_id: str) -> bool:
    return bool(CHAT_RE.match((chat_id or "").strip()))


def token_for(firm: Optional[Firm]) -> tuple:
    """(token, source). A firm's own bot wins over the server-wide one from the environment."""
    own = ((firm.settings or {}).get("telegram_bot_token") if firm else None) or ""
    if own:
        return own, "firm"
    if TELEGRAM_BOT_TOKEN:
        return TELEGRAM_BOT_TOKEN, "server"
    return "", None


def hint(token: str) -> str:
    return f"…{token[-4:]}" if token else ""


def _client(client=None):
    if client is not None:
        return client
    import httpx
    return httpx.Client(timeout=20)


def _call(token: str, method: str, payload: Optional[dict] = None, client=None) -> dict:
    import httpx
    try:
        r = _client(client).post(f"{API}/bot{token}/{method}", json=payload or {})
        data = r.json() if r.content else {}
    except httpx.HTTPError:
        raise TelegramError("Could not reach Telegram. Check the internet connection.") from None
    except ValueError:
        raise TelegramError("Telegram sent a reply that could not be read.") from None
    if not data.get("ok"):
        desc = str(data.get("description") or f"HTTP {getattr(r, 'status_code', '?')}")
        if "chat not found" in desc.lower():
            desc = "Telegram cannot find this chat. Open the bot in Telegram and press Start, then choose your chat again."
        raise TelegramError(desc)
    return data


def get_me(token: str, client=None) -> dict:
    return _call(token, "getMe", client=client)["result"]


def recent_chats(token: str, client=None) -> list:
    """People who have written to the bot lately (private chats only), newest first."""
    res = _call(token, "getUpdates", {"limit": 100, "timeout": 0}, client=client)["result"]
    seen: dict = {}
    for u in reversed(res):
        chat = (u.get("message") or u.get("my_chat_member") or {}).get("chat") or {}
        if chat.get("type") == "private" and chat.get("id") not in seen:
            name = " ".join(x for x in (chat.get("first_name"), chat.get("last_name")) if x) or chat.get("username") or ""
            seen[chat["id"]] = {"id": str(chat["id"]), "name": name, "username": chat.get("username")}
    return list(seen.values())


def _chunks(text: str) -> list:
    out, cur = [], ""
    for line in text.split("\n"):
        while len(line) > LIMIT:
            if cur:
                out.append(cur)
                cur = ""
            out.append(line[:LIMIT])
            line = line[LIMIT:]
        if len(cur) + len(line) + 1 > LIMIT:
            out.append(cur)
            cur = line
        else:
            cur = f"{cur}\n{line}" if cur else line
    if cur:
        out.append(cur)
    return out or [""]


def send_message(token: str, chat_id: str, text: str, client=None) -> dict:
    if not token:
        raise TelegramError("No Telegram bot is connected. An admin can add the bot token in Settings.")
    if not valid_chat(chat_id):
        raise TelegramError("Enter your Telegram chat ID in Settings.")
    sent = 0
    for part in _chunks(text):
        _call(token, "sendMessage", {"chat_id": chat_id.strip(), "text": part, "disable_web_page_preview": True},
              client=client)
        sent += 1
    return {"ok": True, "messages": sent}
