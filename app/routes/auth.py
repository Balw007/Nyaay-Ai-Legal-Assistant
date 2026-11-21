"""Sign-up (first owner), sign-in, sessions, invites and team management."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import COOKIE_SECURE, PUBLIC_URL, SESSION_DAYS, WEB_URL
from ..db import get_db
from ..deps import COOKIE, ROLE_RANK, audit, get_user, require_role
from ..models import ROLES, AuthSession, Firm, Invite, Matter, User
from ..services.security import (hash_password, login_throttle, new_token, password_problem, token_hash,
                                 verify_password)

router = APIRouter(tags=["auth"])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "firm_id": u.firm_id,
            "phone": u.phone, "enrolment_no": u.enrolment_no, "whatsapp_brief": bool(u.whatsapp_brief),
            "telegram_chat_id": u.telegram_chat_id, "telegram_brief": bool(u.telegram_brief),
            "active": u.active, "last_login": u.last_login.isoformat() if u.last_login else None}


def _start_session(db: Session, u: User, request: Request, response: Response) -> str:
    tok = new_token()
    db.add(AuthSession(token_hash=token_hash(tok), user_id=u.id, expires_at=_now() + timedelta(days=SESSION_DAYS),
                       user_agent=(request.headers.get("user-agent") or "")[:300]))
    u.last_login = _now()
    response.set_cookie(COOKIE, tok, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax",
                        secure=COOKIE_SECURE, path="/")
    return tok


def _norm_email(e: str) -> str:
    e = (e or "").strip().lower()
    if "@" not in e or "." not in e.split("@")[-1] or len(e) > 254:
        raise HTTPException(422, "Enter a valid email address")
    return e


class SetupIn(BaseModel):
    firm_name: str
    name: str
    email: str
    password: str
    enrolment_no: Optional[str] = None
    demo: bool = True


class LoginIn(BaseModel):
    email: str
    password: str


class InviteIn(BaseModel):
    email: str
    role: str = "advocate"


class AcceptIn(BaseModel):
    token: str
    name: str
    password: str
    enrolment_no: Optional[str] = None


class ProfileIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    enrolment_no: Optional[str] = None
    whatsapp_brief: Optional[bool] = None
    telegram_chat_id: Optional[str] = None
    telegram_brief: Optional[bool] = None


class PasswordIn(BaseModel):
    current: str
    new: str


class TeamPatch(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None
    phone: Optional[str] = None


@router.get("/auth/status")
def status(request: Request, db: Session = Depends(get_db)):
    return {"has_users": db.query(User).count() > 0}


@router.post("/auth/setup", status_code=201)
def setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Create the first firm and its owner. Only allowed while the installation has no users.
    Existing data from before accounts were added (firm 1) is attached to this owner's firm."""
    if db.query(User).count():
        raise HTTPException(409, "Already set up. Ask your firm's admin for an invite.")
    if not body.firm_name.strip() or not body.name.strip():
        raise HTTPException(422, "Firm name and your name are required")
    if (p := password_problem(body.password)):
        raise HTTPException(422, p)
    firm = db.get(Firm, 1) or Firm(id=1, name=body.firm_name.strip())
    firm.name = body.firm_name.strip()
    db.add(firm)
    db.flush()
    u = User(firm_id=firm.id, email=_norm_email(body.email), name=body.name.strip(),
             password_hash=hash_password(body.password), role="owner", enrolment_no=body.enrolment_no or None)
    db.add(u)
    db.flush()
    _start_session(db, u, request, response)
    audit(db, firm.id, u.email, "setup", "firm", firm.id)
    db.commit()
    if body.demo and not db.query(Matter).filter(Matter.firm_id == firm.id).first():
        from ..services.demo import seed
        seed(db, firm.id)
    return {"user": user_dict(u), "firm": {"id": firm.id, "name": firm.name}}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = (body.email or "").strip().lower()
    key = f"{email}|{request.client.host if request.client else ''}"
    if login_throttle.blocked(key):
        raise HTTPException(429, "Too many attempts. Wait ten minutes and try again.")
    u = db.query(User).filter(User.email == email).first()
    if not u or not u.active or not verify_password(body.password, u.password_hash):
        login_throttle.fail(key)
        raise HTTPException(401, "Email or password is incorrect")
    login_throttle.clear(key)
    _start_session(db, u, request, response)
    audit(db, u.firm_id, u.email, "login", "user", u.id)
    db.commit()
    return {"user": user_dict(u)}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    tok = request.cookies.get(COOKIE)
    if tok:
        db.query(AuthSession).filter(AuthSession.token_hash == token_hash(tok)).delete()
        db.commit()
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(get_user), db: Session = Depends(get_db)):
    from ..services.ai import firm_settings
    firm = db.get(Firm, user.firm_id)
    return {"user": user_dict(user), "firm": {"id": firm.id, "name": firm.name, "settings": firm_settings(firm)}}


@router.patch("/auth/me")
def update_me(body: ProfileIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "phone" in data:
        data["phone"] = _norm_phone(data["phone"])
    if "telegram_chat_id" in data:
        from ..services.telegram import valid_chat
        chat = (data["telegram_chat_id"] or "").strip()
        if chat and not valid_chat(chat):
            raise HTTPException(422, "A Telegram chat ID is a number such as 123456789. Use 'Find my chat' in Settings.")
        data["telegram_chat_id"] = chat or None
    chat_now = data["telegram_chat_id"] if "telegram_chat_id" in data else user.telegram_chat_id
    if data.get("telegram_brief") and not chat_now:
        raise HTTPException(422, "Choose your Telegram chat before switching the Telegram brief on.")
    if not chat_now:
        data["telegram_brief"] = False
    for k, v in data.items():
        setattr(user, k, v)
    db.merge(user)
    db.commit()
    return user_dict(db.get(User, user.id))


@router.post("/auth/password")
def change_password(body: PasswordIn, request: Request, user: User = Depends(get_user), db: Session = Depends(get_db)):
    u = db.get(User, user.id)
    if not verify_password(body.current, u.password_hash):
        raise HTTPException(401, "Current password is incorrect")
    if (p := password_problem(body.new)):
        raise HTTPException(422, p)
    u.password_hash = hash_password(body.new)
    keep = token_hash(request.cookies.get(COOKIE, ""))
    db.query(AuthSession).filter(AuthSession.user_id == u.id, AuthSession.token_hash != keep).delete()
    audit(db, u.firm_id, u.email, "change_password", "user", u.id)
    db.commit()
    return {"ok": True}


def _norm_phone(p: Optional[str]) -> Optional[str]:
    if not p:
        return None
    digits = "".join(c for c in p if c.isdigit())
    if len(digits) == 10:
        digits = "91" + digits
    if not 11 <= len(digits) <= 15:
        raise HTTPException(422, "Enter the mobile number with country code, e.g. +91 98xxxxxxxx")
    return digits


# ------------------------------------------------------------------ team

@router.get("/team")
def team(user: User = Depends(get_user), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.firm_id == user.firm_id).order_by(User.id).all()
    inv = db.query(Invite).filter(Invite.firm_id == user.firm_id, Invite.used_at.is_(None),
                                  Invite.expires_at > _now()).all()
    return {"users": [user_dict(u) for u in users],
            "invites": [{"id": i.id, "email": i.email, "role": i.role, "expires_at": i.expires_at.isoformat()} for i in inv]}


@router.post("/team/invites", status_code=201)
def invite(body: InviteIn, request: Request, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    if body.role not in ROLES or body.role == "owner":
        raise HTTPException(422, "Role must be admin, advocate or clerk")
    if ROLE_RANK[body.role] > ROLE_RANK[user.role]:
        raise HTTPException(403, "You cannot invite someone with a higher role than yours")
    email = _norm_email(body.email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "This email already has an account")
    tok = new_token()
    db.add(Invite(firm_id=user.firm_id, email=email, role=body.role, token_hash=token_hash(tok),
                  expires_at=_now() + timedelta(days=7), created_by=user.id))
    audit(db, user.firm_id, user.email, "invite", "user", None, {"email": email, "role": body.role})
    db.commit()
    import os
    return {"email": email, "role": body.role, "link": f"{WEB_URL}/login?invite={tok}",
            "note": "Share this link privately. It works once and expires in 7 days."}


@router.delete("/team/invites/{iid}", status_code=204)
def revoke_invite(iid: int, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    i = db.get(Invite, iid)
    if not i or i.firm_id != user.firm_id:
        raise HTTPException(404, "Invite not found")
    db.delete(i)
    db.commit()
    return Response(status_code=204)


@router.get("/auth/invite/{token}")
def invite_info(token: str, db: Session = Depends(get_db)):
    i = db.query(Invite).filter(Invite.token_hash == token_hash(token)).first()
    if not i or i.used_at or i.expires_at < _now():
        raise HTTPException(404, "This invite link is invalid or has expired")
    return {"email": i.email, "role": i.role, "firm": db.get(Firm, i.firm_id).name}


@router.post("/auth/accept", status_code=201)
def accept(body: AcceptIn, request: Request, response: Response, db: Session = Depends(get_db)):
    i = db.query(Invite).filter(Invite.token_hash == token_hash(body.token)).first()
    if not i or i.used_at or i.expires_at < _now():
        raise HTTPException(404, "This invite link is invalid or has expired")
    if (p := password_problem(body.password)):
        raise HTTPException(422, p)
    if db.query(User).filter(User.email == i.email).first():
        raise HTTPException(409, "This email already has an account")
    u = User(firm_id=i.firm_id, email=i.email, name=body.name.strip() or i.email, role=i.role,
             password_hash=hash_password(body.password), enrolment_no=body.enrolment_no or None)
    db.add(u)
    i.used_at = _now()
    db.flush()
    _start_session(db, u, request, response)
    audit(db, i.firm_id, u.email, "join", "user", u.id, {"role": u.role})
    db.commit()
    return {"user": user_dict(u)}


@router.patch("/team/{uid}")
def update_member(uid: int, body: TeamPatch, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    u = db.get(User, uid)
    if not u or u.firm_id != user.firm_id:
        raise HTTPException(404, "User not found")
    if u.role == "owner" and (body.role not in (None, "owner") or body.active is False):
        raise HTTPException(409, "The owner cannot be demoted or disabled")
    if body.role:
        if body.role not in ROLES or body.role == "owner" or ROLE_RANK[body.role] > ROLE_RANK[user.role]:
            raise HTTPException(422, "Invalid role")
        u.role = body.role
    if body.active is not None:
        u.active = body.active
        if not body.active:
            db.query(AuthSession).filter(AuthSession.user_id == u.id).delete()
    if body.phone is not None:
        u.phone = _norm_phone(body.phone)
    audit(db, user.firm_id, user.email, "update_member", "user", u.id, body.model_dump(exclude_unset=True))
    db.commit()
    return user_dict(u)
