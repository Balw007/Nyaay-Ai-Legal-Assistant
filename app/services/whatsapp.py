"""WhatsApp Cloud API (Meta) — the channel Indian advocates already live in.

Inbound: an advocate forwards a court order (PDF/photo) or a question to the firm's WhatsApp number.
  * the sender must be a registered user (their mobile number on their profile)
  * the matter is picked from the caption: a CNR, a case number, or "#<matter id>"
  * the order is read and tasks are PROPOSED; the reply says what was found and links to approve
Commands: "brief" (today's brief), "help".
Outbound: replies inside the 24-hour window are free-form text; the scheduled morning brief uses an approved
template (WHATSAPP_BRIEF_TEMPLATE), as Meta requires for business-initiated messages.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from ..config import PUBLIC_URL, WA_APP_SECRET, WA_BRIEF_TEMPLATE, WA_GRAPH_VERSION, WA_PHONE_ID, WA_TOKEN
from ..models import Matter, User, WhatsAppMessage

GRAPH = "https://graph.facebook.com"
CNR_RE = re.compile(r"\b([A-Z]{4}\d{12})\b")
ID_RE = re.compile(r"#(\d{1,7})\b")


def configured() -> bool:
    return bool(WA_TOKEN and WA_PHONE_ID)


def verify_signature(body: bytes, header: Optional[str]) -> bool:
    if not WA_APP_SECRET:
        return True  # signature checking needs the app secret; set WHATSAPP_APP_SECRET in production
    if not header or not header.startswith("sha256="):
        return False
    mac = hmac.new(WA_APP_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, header[7:])


def _client(client=None):
    if client is not None:
        return client
    import httpx
    return httpx.Client(timeout=30)


def send_text(to: str, body: str, client=None, db: Optional[Session] = None, firm_id: Optional[int] = None) -> dict:
    if not configured():
        return {"skipped": "WhatsApp not configured"}
    c = _client(client)
    r = c.post(f"{GRAPH}/{WA_GRAPH_VERSION}/{WA_PHONE_ID}/messages",
               headers={"Authorization": f"Bearer {WA_TOKEN}"},
               json={"messaging_product": "whatsapp", "to": to, "type": "text",
                     "text": {"preview_url": False, "body": body[:4000]}})
    data = r.json() if r.content else {}
    if db is not None:
        mid = ((data.get("messages") or [{}])[0]).get("id") or f"out-{to}-{hash(body)}"
        db.add(WhatsAppMessage(wa_id=mid[:120], firm_id=firm_id, phone=to, direction="out", kind="text", body=body[:4000]))
    return data


def send_brief_template(to: str, text: str, client=None) -> dict:
    if not (configured() and WA_BRIEF_TEMPLATE):
        return {"skipped": "No approved brief template (WHATSAPP_BRIEF_TEMPLATE)"}
    c = _client(client)
    r = c.post(f"{GRAPH}/{WA_GRAPH_VERSION}/{WA_PHONE_ID}/messages", headers={"Authorization": f"Bearer {WA_TOKEN}"},
               json={"messaging_product": "whatsapp", "to": to, "type": "template",
                     "template": {"name": WA_BRIEF_TEMPLATE, "language": {"code": "en"},
                                  "components": [{"type": "body", "parameters": [{"type": "text",
                                                                                   "text": text[:1000]}]}]}})
    return r.json() if r.content else {}


def download_media(media_id: str, client=None) -> tuple:
    c = _client(client)
    h = {"Authorization": f"Bearer {WA_TOKEN}"}
    meta = c.get(f"{GRAPH}/{WA_GRAPH_VERSION}/{media_id}", headers=h).json()
    data = c.get(meta["url"], headers=h).content
    return data, meta.get("mime_type", "")


def find_matter(db: Session, firm_id: int, caption: str) -> Optional[Matter]:
    caption = caption or ""
    m = ID_RE.search(caption)
    if m:
        x = db.get(Matter, int(m.group(1)))
        if x and x.firm_id == firm_id:
            return x
    m = CNR_RE.search(caption.upper())
    if m:
        x = db.query(Matter).filter(Matter.firm_id == firm_id, Matter.cnr == m.group(1)).first()
        if x:
            return x
    cap = re.sub(r"\s+", "", caption.lower())
    if len(cap) >= 4:
        for x in db.query(Matter).filter(Matter.firm_id == firm_id, Matter.case_number.isnot(None)):
            if re.sub(r"\s+", "", x.case_number.lower()) in cap:
                return x
    return None


HELP = ("Nyaay on WhatsApp\n• Forward a court order (PDF or photo) with the CNR, case number or #matter-id in the "
        "caption — I'll read it and queue the next steps for your approval.\n• Send *brief* for today's cause list "
        "and deadlines.\n• Ask a legal question in plain words for a cited answer.")


def user_for_phone(db: Session, phone: str) -> Optional[User]:
    return db.query(User).filter(User.phone == phone, User.active.is_(True)).first()


def handle_message(db: Session, msg: dict, client=None) -> Optional[str]:
    """Process one inbound message. Returns the reply text (also sent)."""
    from .brief import build_brief, render_text
    from .order_intake import IntakeError, intake

    wa_id, phone, kind = msg.get("id", ""), msg.get("from", ""), msg.get("type", "")
    if db.query(WhatsAppMessage).filter(WhatsAppMessage.wa_id == wa_id).first():
        return None  # Meta retries deliveries; process each message once
    u = user_for_phone(db, phone)
    db.add(WhatsAppMessage(wa_id=wa_id[:120], firm_id=u.firm_id if u else None, phone=phone, direction="in",
                           kind=kind, body=(msg.get("text") or {}).get("body", "")[:4000]))
    db.commit()
    if not u:
        reply = "This number is not registered with Nyaay. Ask your firm admin to add it to your profile."
    elif kind == "text":
        body = (msg.get("text") or {}).get("body", "").strip()
        if body.lower() in ("brief", "today", "cause list"):
            reply = render_text(build_brief(db, u.firm_id, date.today()))
        elif body.lower() in ("help", "hi", "hello", "menu"):
            reply = HELP
        else:
            reply = _answer(db, u, body)
    elif kind in ("document", "image"):
        part = msg.get(kind) or {}
        caption = part.get("caption", "") or part.get("filename", "")
        m = find_matter(db, u.firm_id, caption)
        if not m:
            reply = ("I couldn't tell which matter this order is for. Forward it again with the CNR, case number "
                     "or #matter-id in the caption.")
        else:
            try:
                data, mime = download_media(part["id"], client)
                fname = part.get("filename") or ("order.pdf" if "pdf" in mime else "order.jpg")
                r = intake(db, u.firm_id, m, data=data, filename=fname, source="whatsapp")
                o = r["order"]
                if r["duplicate"]:
                    reply = f"Already have this order for {m.title}."
                else:
                    nd = f"Next date: {o.next_date:%d %b %Y}" if o.next_date else "Next date: not found — please check"
                    reply = (f"Read the order for {m.title}.\n{nd}\n{len(r['tasks'])} action(s) waiting for your "
                             f"approval: {PUBLIC_URL}/app/#/m/{m.id}/tasks")
            except IntakeError as exc:
                reply = f"I couldn't read that file: {exc}"
            except Exception as exc:
                reply = f"Something went wrong reading that file ({type(exc).__name__}). Please upload it in the app."
    else:
        reply = HELP
    send_text(phone, reply, client=client, db=db, firm_id=u.firm_id if u else None)
    db.commit()
    return reply


def _answer(db: Session, u: User, q: str) -> str:
    from .ai import firm_llm
    from .research import ask
    from .store import get_store

    if len(q) < 8:
        return HELP
    r = ask(get_store(), firm_llm(db, u.firm_id, "answer", u.id), q)
    if r.get("answer"):
        refs = "\n".join(f"[{s['sid']}] {s['title']}{', ' + s['citation'] if s['citation'] else ''}, para {s['para_no']}"
                         for s in r["sources"] if s["sid"] in r["checks"]["cited_sources"])
        text = re.sub(r"\[S(\d+)\]", r"[\1]", r["answer"])
        return f"{text}\n\nSources:\n{refs}\n\nRead each paragraph before relying on it."
    tops = "\n".join(f"• {s['title']}, para {s['para_no']}" for s in (r.get("sources") or [])[:3])
    return (r.get("message") or "No answer.") + (f"\n\nMost relevant:\n{tops}" if tops else "")
