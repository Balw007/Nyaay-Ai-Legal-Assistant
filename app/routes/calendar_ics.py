"""Calendar export: download or subscribe to hearings and deadlines (.ics), for the whole chambers or one matter.

Subscribing needs a private link, because calendar apps cannot sign in. The link carries a secret token that is
stored hashed, shown once, and can be revoked at any time."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..config import PUBLIC_URL
from ..db import get_db
from ..deps import audit, get_matter_or_404, get_user
from ..models import User
from ..services import ics
from ..services.security import new_token, token_hash

router = APIRouter(tags=["calendar"])


async def feed_user(request: Request, token: Optional[str] = None, db: Session = Depends(get_db)) -> User:
    """Signed-in user, or the owner of a valid calendar feed token (read-only, this one endpoint)."""
    if token:
        u = db.query(User).filter(User.calendar_token_hash == token_hash(token), User.active.is_(True)).first()
        if not u:
            raise HTTPException(401, "This calendar link is not valid any more. Create a new one in Settings.")
        return u
    return await get_user(request, db)


def _response(text: str, filename: str, download: bool) -> Response:
    headers = {"Cache-Control": "no-store"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return Response(text, media_type="text/calendar; charset=utf-8", headers=headers)


@router.get("/calendar.ics")
def firm_calendar(download: bool = False, user: User = Depends(feed_user), db: Session = Depends(get_db)):
    events = ics.collect(db, user.firm_id)
    return _response(ics.render(events, ics.calendar_name(db, user.firm_id)), "nyaay-calendar.ics", download)


@router.get("/matters/{matter_id}/calendar.ics")
def matter_calendar(matter_id: int, download: bool = False, user: User = Depends(feed_user), db: Session = Depends(get_db)):
    m = get_matter_or_404(db, user.firm_id, matter_id)
    events = ics.collect(db, user.firm_id, matter_id=m.id)
    return _response(ics.render(events, ics.calendar_name(db, user.firm_id, m)), f"nyaay-matter-{m.id}.ics", download)


@router.get("/calendar/feed")
def feed_status(user: User = Depends(get_user)):
    return {"enabled": bool(user.calendar_token_hash)}


@router.post("/calendar/feed")
def create_feed(user: User = Depends(get_user), db: Session = Depends(get_db)):
    """Create (or replace) your private subscription link. The token is shown only now."""
    tok = new_token()
    u = db.get(User, user.id)
    u.calendar_token_hash = token_hash(tok)
    audit(db, u.firm_id, u.email, "create_calendar_feed", "user", u.id)
    db.commit()
    base = PUBLIC_URL.rstrip("/")
    url = f"{base}/calendar.ics?token={tok}"
    return {"enabled": True, "url": url, "webcal": url.replace("https://", "webcal://").replace("http://", "webcal://"),
            "note": "Anyone with this link can read your hearings and deadlines. Replace it if it is shared by mistake."}


@router.delete("/calendar/feed", status_code=204)
def revoke_feed(user: User = Depends(get_user), db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    u.calendar_token_hash = None
    audit(db, u.firm_id, u.email, "revoke_calendar_feed", "user", u.id)
    db.commit()
    return Response(status_code=204)
