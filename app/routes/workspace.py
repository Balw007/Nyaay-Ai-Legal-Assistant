"""Firm workspace: dashboard, calendar, notes, saved judgments, drafts, clients, activity, global search."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404
from ..models import AuditLog, Bookmark, Deadline, Draft, Matter, Note, Order, SearchHistory, Task, utcnow
from ..serializers import bookmark_dict, draft_dict, matter_dict, note_dict, order_dict
from ..services import drafting as dft
from ..services import reviews as rv
from ..services import playbook as pbk
from ..services.ai import firm_llm
from ..services.llm import get_llm
from ..services.store import get_store

router = APIRouter(tags=["workspace"])


# ------------------------------------------------------------------ matters (edit)

class MatterPatch(BaseModel):
    title: Optional[str] = None
    court: Optional[str] = None
    case_number: Optional[str] = None
    cnr: Optional[str] = None
    client_name: Optional[str] = None
    goal: Optional[str] = None
    status: Optional[str] = None
    next_date: Optional[date] = None
    current_stage: Optional[str] = None
    details: Optional[dict] = None


@router.patch("/matters/{matter_id}")
def patch_matter(matter_id: int, body: MatterPatch, db: Session = Depends(get_db),
                 firm_id: int = Depends(get_firm_id)):
    m = get_matter_or_404(db, firm_id, matter_id)
    data = body.model_dump(exclude_unset=True)
    if "status" in data and data["status"] not in {"active", "closed", "on_hold"}:
        raise HTTPException(422, "status must be active, on_hold or closed")
    if data.get("current_stage"):
        if not pbk.stage_by_id(pbk.get_playbook(m.case_type), data["current_stage"]):
            raise HTTPException(422, "Unknown stage")
    if "details" in data:
        merged = dict(m.details or {})
        merged.update({k: str(v).strip() for k, v in (data.pop("details") or {}).items()
                       if k in dft.FIELDS})
        m.details = {k: v for k, v in merged.items() if v}
    for k, v in data.items():
        setattr(m, k, v)
    audit(db, firm_id, "advocate", "update", "matter", m.id, {"fields": sorted(body.model_dump(exclude_unset=True))})
    db.commit()
    return matter_dict(m)


# ------------------------------------------------------------------ notes

class NoteIn(BaseModel):
    body: str


@router.get("/matters/{matter_id}/notes")
def list_notes(matter_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    get_matter_or_404(db, firm_id, matter_id)
    return [note_dict(n) for n in db.query(Note).filter(Note.matter_id == matter_id).order_by(Note.id.desc())]


@router.post("/matters/{matter_id}/notes", status_code=201)
def add_note(matter_id: int, body: NoteIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    get_matter_or_404(db, firm_id, matter_id)
    if not body.body.strip():
        raise HTTPException(422, "Empty note")
    n = Note(firm_id=firm_id, matter_id=matter_id, body=body.body.strip())
    db.add(n)
    db.flush()
    audit(db, firm_id, "advocate", "add_note", "matter", matter_id)
    db.commit()
    return note_dict(n)


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    n = db.get(Note, note_id)
    if not n or n.firm_id != firm_id:
        raise HTTPException(404, "Note not found")
    db.delete(n)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ saved judgments

class BookmarkIn(BaseModel):
    jid: str
    para_no: Optional[int] = None
    matter_id: Optional[int] = None
    note: str = ""


class BookmarkPatch(BaseModel):
    note: Optional[str] = None
    matter_id: Optional[int] = None


@router.get("/bookmarks")
def list_bookmarks(matter_id: Optional[int] = None, db: Session = Depends(get_db),
                   firm_id: int = Depends(get_firm_id)):
    q = db.query(Bookmark).filter(Bookmark.firm_id == firm_id)
    if matter_id:
        q = q.filter(Bookmark.matter_id == matter_id)
    return [bookmark_dict(b) for b in q.order_by(Bookmark.id.desc()).limit(500)]


@router.post("/bookmarks", status_code=201)
def add_bookmark(body: BookmarkIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    j = get_store().get_judgment(body.jid)
    if not j:
        raise HTTPException(404, "Judgment not found")
    if body.matter_id:
        get_matter_or_404(db, firm_id, body.matter_id)
    excerpt = ""
    if body.para_no is not None:
        p = next((p for p in j["paragraphs"] if p["no"] == body.para_no), None)
        if not p:
            raise HTTPException(404, "No such paragraph")
        excerpt = p["text"][:1500]
    dup = db.query(Bookmark).filter(Bookmark.firm_id == firm_id, Bookmark.jid == body.jid,
                                    Bookmark.para_no == body.para_no, Bookmark.matter_id == body.matter_id).first()
    if dup:
        return bookmark_dict(dup)
    b = Bookmark(firm_id=firm_id, matter_id=body.matter_id, jid=body.jid, title=j["title"],
                 citation=(j["citations"] or [""])[0], para_no=body.para_no, excerpt=excerpt, note=body.note)
    db.add(b)
    db.flush()
    audit(db, firm_id, "advocate", "save_judgment", "bookmark", b.id, {"jid": body.jid, "para": body.para_no})
    db.commit()
    return bookmark_dict(b)


@router.patch("/bookmarks/{bid}")
def patch_bookmark(bid: int, body: BookmarkPatch, db: Session = Depends(get_db),
                   firm_id: int = Depends(get_firm_id)):
    b = db.get(Bookmark, bid)
    if not b or b.firm_id != firm_id:
        raise HTTPException(404, "Not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("matter_id"):
        get_matter_or_404(db, firm_id, data["matter_id"])
    for k, v in data.items():
        setattr(b, k, v)
    db.commit()
    return bookmark_dict(b)


@router.delete("/bookmarks/{bid}", status_code=204)
def delete_bookmark(bid: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    b = db.get(Bookmark, bid)
    if not b or b.firm_id != firm_id:
        raise HTTPException(404, "Not found")
    db.delete(b)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ drafts

class DraftIn(BaseModel):
    template: str
    matter_id: Optional[int] = None
    title: Optional[str] = None
    extra: dict = {}


class DraftPatch(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None


@router.get("/drafts/templates")
def templates():
    return {"fields": dft.FIELDS,
            "templates": [{"id": k, **v} for k, v in dft.TEMPLATES.items()]}


@router.get("/drafts")
def list_drafts(matter_id: Optional[int] = None, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    q = db.query(Draft).filter(Draft.firm_id == firm_id)
    if matter_id:
        q = q.filter(Draft.matter_id == matter_id)
    titles = {m.id: m.title for m in db.query(Matter).filter(Matter.firm_id == firm_id)}
    out = []
    for d in q.order_by(Draft.updated_at.desc()).limit(300):
        x = draft_dict(d, with_body=False)
        x["matter"] = titles.get(d.matter_id)
        x["placeholders"] = len(dft.missing(d.body))
        out.append(x)
    return out


def _get_draft(db: Session, firm_id: int, did: int) -> Draft:
    d = db.get(Draft, did)
    if not d or d.firm_id != firm_id:
        raise HTTPException(404, "Draft not found")
    return d


@router.post("/drafts", status_code=201)
def create_draft(body: DraftIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    if body.template not in dft.TEMPLATES:
        raise HTTPException(422, f"Unknown template. Available: {sorted(dft.TEMPLATES)}")
    mdict, plan, orders = {"facts": {}, "details": {}}, None, []
    if body.matter_id:
        m = get_matter_or_404(db, firm_id, body.matter_id)
        mdict = matter_dict(m)
        plan = pbk.plan(pbk.get_playbook(m.case_type), m.current_stage)
        orders = [order_dict(o) for o in db.query(Order).filter(Order.matter_id == m.id)]
    text = dft.render(body.template, mdict, body.extra, plan, orders)
    title = body.title or f"{dft.TEMPLATES[body.template]['name']}" + (f" — {mdict.get('title')}" if body.matter_id else "")
    d = Draft(firm_id=firm_id, matter_id=body.matter_id, template=body.template, title=title[:300], body=text)
    db.add(d)
    db.flush()
    audit(db, firm_id, "advocate", "create_draft", "draft", d.id, {"template": body.template})
    db.commit()
    out = draft_dict(d)
    out["placeholders"] = dft.missing(text)
    out["template_review"] = rv.status_of(db, firm_id, "template", d.template)
    return out


@router.get("/drafts/{did}")
def get_draft(did: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    d = _get_draft(db, firm_id, did)
    out = draft_dict(d)
    out["placeholders"] = dft.missing(d.body)
    out["template_review"] = rv.status_of(db, firm_id, "template", d.template)
    return out


@router.put("/drafts/{did}")
def update_draft(did: int, body: DraftPatch, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    d = _get_draft(db, firm_id, did)
    data = body.model_dump(exclude_unset=True)
    if data.get("status") and data["status"] not in {"draft", "final"}:
        raise HTTPException(422, "status must be draft or final")
    if data.get("status") == "final":
        from ..deps import ROLE_RANK, current_user
        u = current_user.get()
        if u is not None and ROLE_RANK.get(u.role, 0) < ROLE_RANK["advocate"]:
            raise HTTPException(403, "Only an advocate can mark a draft final")
    if data.get("status") == "final" and dft.missing(data.get("body", d.body)):
        raise HTTPException(409, "Fill every [[placeholder]] before marking the draft final")
    for k, v in data.items():
        setattr(d, k, v)
    d.updated_at = utcnow()
    db.commit()
    out = draft_dict(d)
    out["placeholders"] = dft.missing(d.body)
    return out


@router.delete("/drafts/{did}", status_code=204)
def delete_draft(did: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    db.delete(_get_draft(db, firm_id, did))
    db.commit()
    return Response(status_code=204)


@router.post("/drafts/{did}/polish")
def polish_draft(did: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    """AI suggestion only: the draft is not changed until the advocate accepts it."""
    d = _get_draft(db, firm_id, did)
    llm = firm_llm(db, firm_id, "polish")
    if not llm.available:
        raise HTTPException(409, "AI is not available: start Ollama (see Settings → AI), or ask an admin to switch AI on.")
    try:
        return dft.polish(d.body, llm)
    except Exception as exc:
        raise HTTPException(502, f"AI polish failed ({type(exc).__name__})")


@router.get("/drafts/{did}/export")
def export_draft(did: int, format: str = "docx", db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    d = _get_draft(db, firm_id, did)
    safe = "".join(c if c.isalnum() or c in " -_" else "_" for c in d.title)[:80].strip() or "draft"
    if format == "docx":
        try:
            data = dft.to_docx(d.title, d.body)
            return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            headers={"Content-Disposition": f'attachment; filename="{safe}.docx"'})
        except ImportError:
            pass  # python-docx not installed: fall back to text
    return Response(d.body, media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.txt"'})


# ------------------------------------------------------------------ calendar

@router.get("/calendar")
def calendar(start: date, end: date, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    if (end - start).days > 120:
        raise HTTPException(422, "Range too long (max 120 days)")
    matters = {m.id: m for m in db.query(Matter).filter(Matter.firm_id == firm_id, Matter.status != "closed")}
    ev = []
    for m in matters.values():
        if m.next_date and start <= m.next_date <= end:
            ev.append({"date": m.next_date.isoformat(), "type": "hearing", "title": m.title, "matter_id": m.id,
                       "detail": " · ".join(x for x in [m.court, m.case_number] if x)})
    for d in db.query(Deadline).filter(Deadline.firm_id == firm_id, Deadline.due_date >= start,
                                       Deadline.due_date <= end):
        m = matters.get(d.matter_id)
        if m and not pbk.deadline_met(pbk.get_playbook(m.case_type), d.rule_id, m.current_stage):
            ev.append({"date": d.due_date.isoformat(), "type": "deadline", "title": d.label, "matter_id": d.matter_id,
                       "detail": matters[d.matter_id].title})
    for t in db.query(Task).filter(Task.firm_id == firm_id, Task.status == "approved",
                                   Task.due_date >= start, Task.due_date <= end):
        if t.matter_id in matters and t.action is None:
            ev.append({"date": t.due_date.isoformat(), "type": "task", "title": t.title, "matter_id": t.matter_id,
                       "detail": matters[t.matter_id].title, "status": t.status})
    ev.sort(key=lambda e: (e["date"], {"deadline": 0, "hearing": 1, "task": 2}[e["type"]]))
    return {"start": start.isoformat(), "end": end.isoformat(), "events": ev}


# ------------------------------------------------------------------ clients

@router.get("/clients")
def clients(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    groups: dict = {}
    for m in db.query(Matter).filter(Matter.firm_id == firm_id):
        name = (m.client_name or "Unassigned").strip()
        g = groups.setdefault(name, {"name": name, "matters": [], "active": 0, "next_date": None})
        g["matters"].append({"id": m.id, "title": m.title, "status": m.status,
                             "next_date": m.next_date.isoformat() if m.next_date else None})
        if m.status == "active":
            g["active"] += 1
            if m.next_date and (g["next_date"] is None or m.next_date.isoformat() < g["next_date"]):
                g["next_date"] = m.next_date.isoformat()
    return sorted(groups.values(), key=lambda g: (g["name"] == "Unassigned", g["name"].lower()))


# ------------------------------------------------------------------ activity

LABELS = {"create": "created", "set_facts": "confirmed dates on", "read_order": "read a court order for",
          "approve": "approved", "reject": "rejected", "done": "completed", "citation_check": "ran a citation check",
          "confirm_citation": "confirmed an authority", "add_note": "added a note to", "update": "updated",
          "save_judgment": "saved a judgment", "create_draft": "created a draft", "demo_seed": "loaded the demo workspace"}


def _activity(db: Session, firm_id: int, limit: int) -> list:
    rows = db.query(AuditLog).filter(AuditLog.firm_id == firm_id).order_by(AuditLog.id.desc()).limit(limit).all()
    titles = {m.id: m.title for m in db.query(Matter).filter(Matter.firm_id == firm_id)}
    tasks = {t.id: t for t in db.query(Task).filter(Task.id.in_([r.object_id for r in rows if r.object_type == "task"]))}
    orders = {o.id: o.matter_id for o in db.query(Order).filter(Order.id.in_(
        [r.object_id for r in rows if r.object_type == "order"]))}
    out = []
    for r in rows:
        what, mid = LABELS.get(r.action, r.action.replace("_", " ")), None
        if r.object_type == "matter":
            mid = r.object_id
        elif r.object_type == "task" and r.object_id in tasks:
            mid = tasks[r.object_id].matter_id
            what = f"{what} “{tasks[r.object_id].title[:80]}” in"
        elif r.object_type == "order":
            mid = orders.get(r.object_id)
        out.append({"id": r.id, "actor": r.actor, "action": r.action, "text": what, "matter_id": mid,
                    "matter": titles.get(mid), "at": r.created_at.isoformat() if r.created_at else None})
    return out


@router.get("/activity")
def activity(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    return _activity(db, firm_id, limit)


# ------------------------------------------------------------------ dashboard

@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    today = date.today()
    week = today + timedelta(days=7)
    matters = {m.id: m for m in db.query(Matter).filter(Matter.firm_id == firm_id)}
    active = [m for m in matters.values() if m.status == "active"]
    hearings = sorted([m for m in active if m.next_date and today <= m.next_date <= week], key=lambda m: m.next_date)
    dl = []
    for d in db.query(Deadline).filter(Deadline.firm_id == firm_id, Deadline.status == "computed"):
        m = matters.get(d.matter_id)
        if not m or m.status != "active" or not d.due_date or d.due_date > today + timedelta(days=21):
            continue
        if pbk.deadline_met(pbk.get_playbook(m.case_type), d.rule_id, m.current_stage):
            continue
        dl.append({"matter_id": m.id, "matter": m.title, "label": d.label, "authority": d.authority,
                   "due_date": d.due_date.isoformat(), "days_left": (d.due_date - today).days})
    dl.sort(key=lambda x: x["due_date"])
    stage_counts: dict = {}
    for m in active:
        try:
            name = pbk.stage_by_id(pbk.get_playbook(m.case_type), m.current_stage)
        except pbk.UnknownCaseType:
            name = None
        key = name["name"] if name else "Not set"
        stage_counts[key] = stage_counts.get(key, 0) + 1

    def hearing(m):
        try:
            prep = pbk.plan(pbk.get_playbook(m.case_type), m.current_stage)
        except pbk.UnknownCaseType:
            prep = {"current_actions": [], "current_stage_name": None}
        return {"matter_id": m.id, "title": m.title, "court": m.court, "case_number": m.case_number,
                "date": m.next_date.isoformat(), "stage": prep.get("current_stage_name"),
                "prepare": prep["current_actions"][:3], "client": m.client_name}

    st = get_store().stats()
    history = [h.query for h in db.query(SearchHistory).filter(SearchHistory.firm_id == firm_id)
               .order_by(SearchHistory.id.desc()).limit(30)]
    seen, recent = set(), []
    for q in history:
        if q.lower() not in seen:
            seen.add(q.lower())
            recent.append(q)
    return {
        "date": today.isoformat(),
        "counts": {
            "active_matters": len(active), "hearings_today": sum(1 for m in active if m.next_date == today),
            "hearings_week": len(hearings), "deadlines_week": sum(1 for d in dl if 0 <= d["days_left"] <= 7),
            "overdue": sum(1 for d in dl if d["days_left"] < 0),
            "pending_approvals": db.query(Task).filter(Task.firm_id == firm_id, Task.status == "proposed").count(),
            "open_tasks": db.query(Task).filter(Task.firm_id == firm_id, Task.status == "approved").count(),
            "drafts": db.query(Draft).filter(Draft.firm_id == firm_id).count(),
            "saved_judgments": db.query(Bookmark).filter(Bookmark.firm_id == firm_id).count(),
        },
        "hearings": [hearing(m) for m in hearings],
        "deadlines": dl,
        "stages": [{"stage": k, "count": v} for k, v in sorted(stage_counts.items(), key=lambda x: -x[1])],
        "activity": _activity(db, firm_id, 12),
        "recent_searches": recent[:6],
        "corpus": st, "llm": firm_llm(db, firm_id, "answer").name,
    }


# ------------------------------------------------------------------ global search (command palette)

@router.get("/search")
def global_search(q: str = Query(..., min_length=2), db: Session = Depends(get_db),
                  firm_id: int = Depends(get_firm_id)):
    like = f"%{q.strip()}%"
    ms = db.query(Matter).filter(Matter.firm_id == firm_id, or_(
        Matter.title.ilike(like), Matter.client_name.ilike(like), Matter.case_number.ilike(like),
        Matter.cnr.ilike(like), Matter.court.ilike(like))).limit(6).all()
    ds = db.query(Draft).filter(Draft.firm_id == firm_id, Draft.title.ilike(like)).limit(5).all()
    try:
        js = get_store().search(q, limit=5)["results"]
    except Exception:
        js = []
    return {"matters": [{"id": m.id, "title": m.title, "sub": " · ".join(x for x in [m.client_name, m.court] if x)}
                        for m in ms],
            "drafts": [{"id": d.id, "title": d.title} for d in ds],
            "judgments": [{"id": j["id"], "title": j["title"], "sub": " · ".join(
                x for x in [j["citation"], j["court"], str(j["year"] or "")] if x)} for j in js]}


# ------------------------------------------------------------------ demo workspace

@router.post("/demo/seed")
def demo_seed(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    from ..services.demo import seed

    n = seed(db, firm_id)
    return {"created_matters": n}
