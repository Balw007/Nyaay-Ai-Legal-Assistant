"""Firm administration: settings & privacy, AI usage, data export/erasure, court holidays, advocate reviews,
feedback and pilot metrics."""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404, get_user, require_role
from ..models import (AnswerCache, AuditLog, Bookmark, CitationCheck, CourtHoliday, Deadline, Draft, Feedback, Firm,
                      Matter, Note, Order, Review, SearchHistory, Task, UsageLog, User)
from ..services import deadlines as dl
from ..services import reviews as rv
from ..services.ai import DEFAULT_SETTINGS, firm_settings, month_usage

router = APIRouter(tags=["admin"])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------ firm settings & privacy

class FirmPatch(BaseModel):
    name: Optional[str] = None
    settings: Optional[dict] = None


@router.get("/firm")
def get_firm(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    f = db.get(Firm, firm_id)
    s = firm_settings(f)
    return {"id": f.id, "name": f.name, "settings": s, "usage_this_month": month_usage(db, firm_id),
            "budget": s["monthly_token_budget"]}


@router.patch("/firm")
def patch_firm(body: FirmPatch, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    f = db.get(Firm, user.firm_id)
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(422, "Firm name cannot be empty")
        f.name = body.name.strip()
    if body.settings:
        s = dict(f.settings or {})
        for k, v in body.settings.items():
            if k not in DEFAULT_SETTINGS:
                raise HTTPException(422, f"Unknown setting: {k}")
            if k == "monthly_token_budget":
                v = int(v)
                if not 0 <= v <= 500_000_000:
                    raise HTTPException(422, "Budget must be between 0 and 500,000,000 tokens")
            elif k == "closed_saturdays":
                if v not in ("none", "second_fourth", "all"):
                    raise HTTPException(422, "closed_saturdays must be none, second_fourth or all")
            else:
                v = bool(v)
            s[k] = v
        f.settings = s
        if "closed_saturdays" in body.settings:
            dl.recompute_firm(db, f.id)
    audit(db, f.id, user.email, "update_firm", "firm", f.id, body.model_dump(exclude_unset=True))
    db.commit()
    return get_firm(db, f.id)


@router.get("/firm/usage")
def usage(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    start = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    by_feature = [{"feature": f, "calls": n, "tokens": int(t or 0)} for f, n, t in db.query(
        UsageLog.feature, func.count(UsageLog.id), func.sum(UsageLog.input_tokens + UsageLog.output_tokens))
        .filter(UsageLog.firm_id == firm_id, UsageLog.created_at >= start).group_by(UsageLog.feature)]
    since = _now() - timedelta(days=30)
    daily: dict = {}
    for row in db.query(UsageLog).filter(UsageLog.firm_id == firm_id, UsageLog.created_at >= since):
        k = row.created_at.date().isoformat()
        daily[k] = daily.get(k, 0) + row.input_tokens + row.output_tokens
    s = firm_settings(db.get(Firm, firm_id))
    return {"month_tokens": month_usage(db, firm_id), "budget": s["monthly_token_budget"],
            "by_feature": sorted(by_feature, key=lambda x: -x["tokens"]),
            "daily": [{"day": k, "tokens": v} for k, v in sorted(daily.items())]}


def _rows(db, model, firm_id):
    out = []
    for r in db.query(model).filter(model.firm_id == firm_id):
        d = {}
        for c in model.__table__.columns:
            if c.name in ("password_hash", "token_hash"):
                continue
            v = getattr(r, c.name)
            d[c.name] = v.isoformat() if isinstance(v, (date, datetime)) else v
        out.append(d)
    return out


@router.get("/firm/export")
def export(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Everything the firm has stored, as one JSON file (data portability, DPDP Act 2023)."""
    data = {"exported_at": _now().isoformat(), "firm": {"id": user.firm_id, "name": db.get(Firm, user.firm_id).name}}
    for name, model in (("users", User), ("matters", Matter), ("orders", Order), ("tasks", Task),
                        ("deadlines", Deadline), ("notes", Note), ("drafts", Draft), ("bookmarks", Bookmark),
                        ("citation_checks", CitationCheck), ("court_holidays", CourtHoliday), ("reviews", Review),
                        ("audit_log", AuditLog)):
        data[name] = _rows(db, model, user.firm_id)
    audit(db, user.firm_id, user.email, "export", "firm", user.firm_id)
    db.commit()
    return Response(json.dumps(data, ensure_ascii=False, indent=1), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="nyaay-export-{date.today()}.json"'})


@router.delete("/matters/{matter_id}", status_code=204)
def erase_matter(matter_id: int, user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Permanently erase a matter and everything attached to it. The audit log keeps only that it happened."""
    m = get_matter_or_404(db, user.firm_id, matter_id)
    for model in (Order, Task, Deadline, Note, Draft, Bookmark, CitationCheck):
        db.query(model).filter(model.matter_id == m.id).delete()
    title = m.title
    db.delete(m)
    audit(db, user.firm_id, user.email, "erase_matter", "matter", matter_id, {"title_len": len(title)})
    db.commit()
    return Response(status_code=204)


def example_counts(db: Session, firm_id: int) -> dict:
    """Fictional demo content: matters titled '... (Demo)' and fixture judgments (year 2099, 'Fictional High Court')."""
    from ..services.store import get_store
    from contextlib import closing
    with closing(get_store().conn()) as c:
        fx = c.execute("SELECT COUNT(*) n FROM judgments WHERE source='fixture'").fetchone()["n"]
    n = db.query(Matter).filter(Matter.firm_id == firm_id, Matter.title.like("% (Demo)")).count()
    return {"matters": n, "judgments": fx}


@router.post("/firm/remove-example-data")
def remove_example_data(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    """Delete every fictional demo matter and the fixture judgments, leaving only real work."""
    from ..services.store import get_store
    ms = db.query(Matter).filter(Matter.firm_id == user.firm_id, Matter.title.like("% (Demo)")).all()
    for m in ms:
        for model in (Order, Task, Deadline, Note, Draft, Bookmark, CitationCheck):
            db.query(model).filter(model.matter_id == m.id).delete()
        db.delete(m)
    removed_j = get_store().purge_source("fixture")
    audit(db, user.firm_id, user.email, "remove_example_data", "firm", user.firm_id,
          {"matters": len(ms), "judgments": removed_j})
    db.commit()
    return {"removed_matters": len(ms), "removed_judgments": removed_j}


TEST_CASE_TITLE = "Sharma v. Verma, NI Act s.138 test case (Demo)"
TEST_CASE_NOTE = ("Court directed us to file the list of witnesses. Collect the original return memo from the client. "
                  "Next date of hearing is 15/01/2027.")


@router.post("/firm/add-test-case", status_code=201)
def add_test_case(user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    """One clearly labelled practice matter so a new user can see deadlines, tasks and drafts working.
    Its title ends in '(Demo)', so 'Remove example data' deletes it. Nothing here is a real case."""
    from ..services import hearing_notes as hn

    old = db.query(Matter).filter(Matter.firm_id == user.firm_id, Matter.title == TEST_CASE_TITLE).first()
    if old:
        return {"matter_id": old.id, "created": False}
    m = Matter(firm_id=user.firm_id, title=TEST_CASE_TITLE, case_type="ni138", client_name="Test Client",
               court="Test Court", case_number="TEST/001/2026",
               goal="Recover the cheque amount with compensation")
    db.add(m)
    db.flush()
    m.facts = {"cheque_date": "2026-08-10", "bank_information_received_date": "2026-09-18",
               "notice_received_date": "2026-10-06"}
    db.flush()
    dl.recompute(db, m)
    db.add(Note(firm_id=user.firm_id, matter_id=m.id, author=user.name,
                body="Hearing note (test case)\n" + TEST_CASE_NOTE))
    res = hn.extract(TEST_CASE_NOTE, None, None)
    if res.get("next_date"):
        db.add(Task(firm_id=user.firm_id, matter_id=m.id, source="hearing_note", action="set_next_date",
                    title=f"Set next hearing date to {res['next_date']:%d %b %Y}", due_date=res["next_date"],
                    payload={"date": res["next_date"].isoformat()}, detail="From the test hearing note."))
    for t in res.get("tasks", []):
        db.add(Task(firm_id=user.firm_id, matter_id=m.id, source="hearing_note", title=t["title"],
                    due_date=t["due_date"], detail="From the test hearing note."))
    audit(db, user.firm_id, user.email, "add_test_case", "matter", m.id, {})
    db.commit()
    return {"matter_id": m.id, "created": True}


@router.post("/firm/purge-ai-cache")
def purge_cache(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    n = db.query(AnswerCache).filter(AnswerCache.firm_id == user.firm_id).delete()
    db.commit()
    return {"deleted": n}


# ------------------------------------------------------------------ court holidays

class HolidayIn(BaseModel):
    day: date
    name: str
    court: str = ""


class HolidayCSV(BaseModel):
    csv: str


def _hol(h: CourtHoliday) -> dict:
    return {"id": h.id, "day": h.day.isoformat(), "name": h.name, "court": h.court}


@router.get("/holidays")
def holidays(year: Optional[int] = None, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    q = db.query(CourtHoliday).filter(CourtHoliday.firm_id == firm_id)
    if year:
        q = q.filter(CourtHoliday.day >= date(year, 1, 1), CourtHoliday.day <= date(year, 12, 31))
    return [_hol(h) for h in q.order_by(CourtHoliday.day)]


@router.post("/holidays", status_code=201)
def add_holiday(body: HolidayIn, user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(422, "Name the holiday")
    h = CourtHoliday(firm_id=user.firm_id, day=body.day, name=body.name.strip(), court=body.court.strip())
    db.add(h)
    db.flush()
    n = dl.recompute_firm(db, user.firm_id)
    audit(db, user.firm_id, user.email, "add_holiday", "holiday", h.id, {"day": body.day.isoformat()})
    db.commit()
    return {**_hol(h), "matters_recomputed": n}


@router.post("/holidays/import")
def import_holidays(body: HolidayCSV, user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    """CSV lines: date,name[,court]. Dates as YYYY-MM-DD or DD-MM-YYYY or DD/MM/YYYY. Duplicates are skipped."""
    have = {(h.day, h.court) for h in db.query(CourtHoliday).filter(CourtHoliday.firm_id == user.firm_id)}
    added, bad = 0, []
    for i, row in enumerate(csv.reader(io.StringIO(body.csv)), 1):
        if not row or not row[0].strip() or row[0].strip().lower() in ("date", "day"):
            continue
        d = None
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y"):
            try:
                d = datetime.strptime(row[0].strip(), fmt).date()
                break
            except ValueError:
                continue
        if not d or len(row) < 2 or not row[1].strip():
            bad.append(i)
            continue
        court = row[2].strip() if len(row) > 2 else ""
        if (d, court) in have:
            continue
        db.add(CourtHoliday(firm_id=user.firm_id, day=d, name=row[1].strip()[:200], court=court[:200]))
        have.add((d, court))
        added += 1
    db.flush()
    n = dl.recompute_firm(db, user.firm_id)
    audit(db, user.firm_id, user.email, "import_holidays", "holiday", None, {"added": added})
    db.commit()
    return {"added": added, "bad_lines": bad, "matters_recomputed": n}


@router.delete("/holidays/{hid}", status_code=204)
def del_holiday(hid: int, user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    h = db.get(CourtHoliday, hid)
    if not h or h.firm_id != user.firm_id:
        raise HTTPException(404, "Not found")
    db.delete(h)
    db.flush()
    dl.recompute_firm(db, user.firm_id)
    db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ advocate review of legal content

class ReviewIn(BaseModel):
    kind: str
    ref: str
    status: str
    comment: str = ""


@router.get("/reviews")
def list_reviews(db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    sm = rv.status_map(db, firm_id)
    items = []
    for i in rv.catalogue():
        st = sm.get((i["kind"], i["ref"]), {})
        items.append({**i, "status": st.get("status", "unreviewed"), "reviewer": st.get("reviewer"),
                      "enrolment": st.get("enrolment"), "at": st.get("at"), "comment": st.get("comment", "")})
    done = sum(1 for i in items if i["status"] == "approved")
    return {"items": items, "approved": done, "total": len(items)}


@router.post("/reviews", status_code=201)
def add_review(body: ReviewIn, user: User = Depends(require_role("advocate")), db: Session = Depends(get_db)):
    if body.status not in ("approved", "changes_requested"):
        raise HTTPException(422, "status must be approved or changes_requested")
    if not user.enrolment_no:
        raise HTTPException(422, "Add your Bar Council enrolment number in your profile before signing off.")
    item = next((i for i in rv.catalogue() if i["kind"] == body.kind and i["ref"] == body.ref), None)
    if not item:
        raise HTTPException(404, "Unknown item")
    if body.status == "changes_requested" and not body.comment.strip():
        raise HTTPException(422, "Say what needs to change")
    db.add(Review(firm_id=user.firm_id, kind=body.kind, ref=body.ref, version=item["version"], status=body.status,
                  comment=body.comment.strip(), reviewer_id=user.id, reviewer_name=user.name,
                  reviewer_enrolment=user.enrolment_no or ""))
    audit(db, user.firm_id, user.email, "review", body.kind, None, {"ref": body.ref, "status": body.status})
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ feedback & pilot metrics

class FeedbackIn(BaseModel):
    kind: str
    ref: str = ""
    rating: int = 0
    comment: str = ""


@router.post("/feedback", status_code=201)
def feedback(body: FeedbackIn, user: User = Depends(get_user), db: Session = Depends(get_db)):
    if body.kind not in ("answer", "draft", "deadline", "order", "search", "general") or body.rating not in (-1, 0, 1):
        raise HTTPException(422, "Invalid feedback")
    db.add(Feedback(firm_id=user.firm_id, user_id=user.id, kind=body.kind, ref=body.ref[:300], rating=body.rating,
                    comment=body.comment[:2000]))
    db.commit()
    return {"ok": True}


@router.get("/metrics")
def metrics(days: int = Query(30, ge=7, le=180), user: User = Depends(require_role("admin")),
            db: Session = Depends(get_db)):
    """What a pilot needs to know: are people coming back, what do they use, what is failing."""
    f = user.firm_id
    since, week = _now() - timedelta(days=days), _now() - timedelta(days=7)
    actors_week = {a for (a,) in db.query(AuditLog.actor).filter(AuditLog.firm_id == f, AuditLog.created_at >= week,
                                                                  AuditLog.actor != "system")}
    searchers = {u for (u,) in db.query(SearchHistory.user_id).filter(SearchHistory.firm_id == f,
                                                                       SearchHistory.created_at >= week)}
    emails = {u.id: u.email for u in db.query(User).filter(User.firm_id == f)}
    active_week = actors_week | {emails.get(u) for u in searchers if u}
    actions = [{"action": a, "count": n} for a, n in db.query(AuditLog.action, func.count(AuditLog.id)).filter(
        AuditLog.firm_id == f, AuditLog.created_at >= since).group_by(AuditLog.action).order_by(func.count(AuditLog.id).desc())]
    weekly: dict = {}
    for (ts, actor) in db.query(AuditLog.created_at, AuditLog.actor).filter(AuditLog.firm_id == f,
                                                                           AuditLog.created_at >= since,
                                                                           AuditLog.actor != "system"):
        wk = (ts.date() - timedelta(days=ts.weekday())).isoformat()
        weekly.setdefault(wk, set()).add(actor)
    fb = db.query(Feedback).filter(Feedback.firm_id == f, Feedback.created_at >= since).all()
    zero = [q for (q,) in db.query(SearchHistory.query).filter(SearchHistory.firm_id == f,
                                                               SearchHistory.created_at >= since,
                                                               SearchHistory.results == 0).limit(50)]
    tasks = db.query(Task).filter(Task.firm_id == f, Task.created_at >= since).all()
    decided = [t for t in tasks if t.status in ("approved", "done", "rejected")]
    return {
        "users": len(emails), "active_this_week": len([a for a in active_week if a]),
        "weekly_active": [{"week": k, "users": len(v)} for k, v in sorted(weekly.items())],
        "actions": actions,
        "searches": db.query(SearchHistory).filter(SearchHistory.firm_id == f, SearchHistory.created_at >= since).count(),
        "zero_result_searches": list(dict.fromkeys(zero))[:20],
        "ai_proposals": len(tasks), "ai_proposals_decided": len(decided),
        "ai_acceptance": round(sum(1 for t in decided if t.status != "rejected") / len(decided), 2) if decided else None,
        "feedback": {"up": sum(1 for x in fb if x.rating > 0), "down": sum(1 for x in fb if x.rating < 0),
                     "comments": [{"kind": x.kind, "rating": x.rating, "comment": x.comment, "ref": x.ref,
                                   "at": x.created_at.isoformat()} for x in fb if x.comment][-20:]},
        "ai_tokens_month": month_usage(db, f),
    }
