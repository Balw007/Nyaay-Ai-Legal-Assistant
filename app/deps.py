"""Shared request dependencies: the signed-in user, their firm, roles, and the audit log.

Every request is scoped to the firm of the signed-in user (session cookie, or 'Authorization: Bearer <token>'
for API/mobile clients). One firm can never read another firm's rows.
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, AuthSession, Matter, User
from .services.security import token_hash

COOKIE = "nyaai_session"
current_user: ContextVar = ContextVar("current_user", default=None)

ROLE_RANK = {"clerk": 0, "advocate": 1, "admin": 2, "owner": 3}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get_user(request: Request, db: Session = Depends(get_db)) -> User:
    # async on purpose: the context variable set here is visible to the (threadpool) endpoint that follows.
    tok = request.cookies.get(COOKIE)
    auth = request.headers.get("authorization", "")
    if not tok and auth.lower().startswith("bearer "):
        tok = auth[7:].strip()
    if not tok:
        raise HTTPException(401, "Sign in required")
    s = db.query(AuthSession).filter(AuthSession.token_hash == token_hash(tok)).first()
    if not s or s.expires_at < _now():
        raise HTTPException(401, "Session expired. Sign in again.")
    u = db.get(User, s.user_id)
    if not u or not u.active:
        raise HTTPException(401, "Account disabled")
    current_user.set(u)
    return u


def get_firm_id(user: User = Depends(get_user)) -> int:
    return user.firm_id


def require_role(minimum: str):
    def dep(user: User = Depends(get_user)) -> User:
        if ROLE_RANK.get(user.role, 0) < ROLE_RANK[minimum]:
            raise HTTPException(403, f"This needs the {minimum} role or higher.")
        return user
    return dep


def get_matter_or_404(db: Session, firm_id: int, matter_id: int) -> Matter:
    m = db.get(Matter, matter_id)
    if not m or m.firm_id != firm_id:
        raise HTTPException(404, "Matter not found")
    return m


def actor_name(default: str = "system") -> str:
    u = current_user.get()
    return u.email if u else default


def audit(db: Session, firm_id: int, actor: str, action: str, object_type: str,
          object_id: Optional[int] = None, detail: Optional[dict] = None) -> None:
    # "advocate" means "whoever is signed in": record the real person.
    if actor == "advocate":
        actor = actor_name("advocate")
    db.add(AuditLog(firm_id=firm_id, actor=actor, action=action, object_type=object_type,
                    object_id=object_id, detail=detail or {}))
