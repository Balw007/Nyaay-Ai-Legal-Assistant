"""The gold set: judgments an advocate has read and vouched for.

A gold entry is a judgment plus the topic it is the authority for, a headnote and the "held" in the advocate's own
words, and the paragraph numbers that carry the point. Only an advocate with a Bar Council enrolment number on file can
verify one. Verified entries are shown to the whole firm as "Verified by <advocate>", and double as the benchmark for
search quality: a search for the topic should bring the verified judgment to the top.
"""
from __future__ import annotations

import csv
import io
import json
from contextlib import closing
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import GoldEntry, User
from .sections import SHORT

STATUSES = ("candidate", "verified", "rejected")
MIN_HEADNOTE = 40
MIN_HELD = 20


class GoldError(ValueError):
    pass


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_dict(e: GoldEntry) -> dict:
    return {"id": e.id, "jid": e.jid, "title": e.title, "citation": e.citation, "topic": e.topic, "status": e.status,
            "headnote": e.headnote, "held": e.held, "issues": e.issues or [], "key_paras": e.key_paras or [],
            "notes": e.notes, "reviewer_name": e.reviewer_name, "reviewer_enrolment": e.reviewer_enrolment,
            "verified_at": e.verified_at.isoformat() if e.verified_at else None,
            "created_at": e.created_at.isoformat(), "updated_at": e.updated_at.isoformat()}


def _cit(j: dict) -> str:
    c = j.get("citations") or []
    return c[0] if c else ""


def add(db: Session, store, firm_id: int, user: User, jid: str, topic: str = "") -> GoldEntry:
    j = store.get_judgment(jid)
    if not j:
        raise GoldError("That judgment is not in the library.")
    if db.query(GoldEntry).filter_by(firm_id=firm_id, jid=jid).first():
        raise GoldError("This judgment is already in your gold set.")
    e = GoldEntry(firm_id=firm_id, jid=jid, title=j["title"], citation=_cit(j), topic=topic.strip()[:200],
                  added_by=user.id)
    db.add(e)
    db.flush()
    return e


def update(db: Session, store, e: GoldEntry, fields: dict) -> GoldEntry:
    """Change the advocate's words. Editing a verified entry returns it to 'candidate': a headnote that was read and
    approved must not change under the verifier's name."""
    changed = False
    for k in ("topic", "headnote", "held", "notes"):
        if k in fields and fields[k] is not None and str(fields[k]).strip() != getattr(e, k):
            setattr(e, k, str(fields[k]).strip())
            changed = True
    if "issues" in fields and fields["issues"] is not None:
        v = [str(x).strip() for x in fields["issues"] if str(x).strip()][:20]
        if v != (e.issues or []):
            e.issues, changed = v, True
    if "key_paras" in fields and fields["key_paras"] is not None:
        v = sorted({int(x) for x in fields["key_paras"]})
        if v != (e.key_paras or []):
            e.key_paras, changed = v, True
    if changed:
        e.updated_at = _now()
        if e.status == "verified":
            e.status, e.reviewer_id, e.reviewer_name, e.reviewer_enrolment, e.verified_at = "candidate", None, "", "", None
    return e


def verify(e: GoldEntry, store, user: User) -> GoldEntry:
    if user.role == "clerk":
        raise GoldError("Only an advocate can verify a judgment.")
    if not (user.enrolment_no or "").strip():
        raise GoldError("Add your Bar Council enrolment number in Settings first. It is recorded with your verification.")
    if len((e.topic or "").strip()) < 3:
        raise GoldError("Say what point of law this judgment is the authority for (the topic).")
    if len((e.headnote or "").strip()) < MIN_HEADNOTE:
        raise GoldError(f"Write the headnote in your own words (at least {MIN_HEADNOTE} characters).")
    if len((e.held or "").strip()) < MIN_HELD:
        raise GoldError(f"Say what the court held (at least {MIN_HELD} characters).")
    j = store.get_judgment(e.jid)
    if not j:
        raise GoldError("The judgment is no longer in the library.")
    have = {p["no"] for p in j["paragraphs"] if p["no"] is not None}
    if not e.key_paras:
        raise GoldError("List the paragraph numbers that carry the point.")
    missing = [n for n in e.key_paras if n not in have]
    if missing:
        raise GoldError(f"This judgment has no paragraph {', '.join(map(str, missing))}.")
    e.status, e.reviewer_id, e.reviewer_name = "verified", user.id, user.name
    e.reviewer_enrolment, e.verified_at, e.updated_at = user.enrolment_no.strip(), _now(), _now()
    return e


def reject(e: GoldEntry, user: User, note: str = "") -> GoldEntry:
    if user.role == "clerk":
        raise GoldError("Only an advocate can reject a judgment.")
    e.status, e.updated_at = "rejected", _now()
    e.reviewer_id, e.reviewer_name, e.reviewer_enrolment, e.verified_at = user.id, user.name, (user.enrolment_no or ""), None
    if note:
        e.notes = note.strip()
    return e


def suggest(store, act: str, section: Optional[str] = None, limit: int = 15, exclude=()) -> list:
    """Candidates worth an advocate's time: the judgments that discuss this section most and are cited most by others."""
    sql = ("SELECT j.id, j.title, j.court, j.year, j.citations, COUNT(DISTINCT r.para_no) mentions, "
           "(SELECT COUNT(DISTINCT x.src) FROM cite_index ci JOIN cites x ON x.norm=ci.norm "
           " WHERE ci.jid=j.id AND x.src!=j.id) cited_by "
           "FROM section_refs r JOIN judgments j ON j.id=r.jid WHERE r.act=? AND j.source!='fixture'")
    args: list = [act]
    if section:
        sql += " AND r.section=?"
        args.append(section.strip().upper())
    sql += " GROUP BY j.id ORDER BY cited_by DESC, mentions DESC, j.year DESC LIMIT ?"
    with closing(store.conn()) as c:
        rows = c.execute(sql, args + [limit + len(list(exclude))]).fetchall()
    out = []
    for r in rows:
        if r["id"] in set(exclude):
            continue
        cits = json.loads(r["citations"] or "[]")
        out.append({"id": r["id"], "title": r["title"], "court": r["court"], "year": r["year"],
                    "citation": cits[0] if cits else "", "mentions": r["mentions"], "cited_by": r["cited_by"]})
    return out[:limit]


def benchmark(store, entries: list, k: int = 10) -> dict:
    """For each verified entry, search its topic and see where the verified judgment lands. This is the honest
    answer to "does search find the right authority?"."""
    rows = []
    for e in entries:
        if e.status != "verified" or not e.topic:
            continue
        res = store.search(e.topic, limit=k)
        ids = [r["id"] for r in res["results"]]
        rank = ids.index(e.jid) + 1 if e.jid in ids else None
        rows.append({"topic": e.topic, "jid": e.jid, "title": e.title, "rank": rank})
    n = len(rows)
    hit = sum(1 for r in rows if r["rank"])
    top1 = sum(1 for r in rows if r["rank"] == 1)
    return {"k": k, "entries": n, "found": hit, "first": top1,
            "recall": round(hit / n, 3) if n else None, "first_rate": round(top1 / n, 3) if n else None, "rows": rows}


def export_csv(entries: list) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["status", "topic", "title", "citation", "jid", "headnote", "held", "key_paras", "verified_by", "enrolment",
                "verified_at"])
    for e in entries:
        w.writerow([e.status, e.topic, e.title, e.citation, e.jid, e.headnote, e.held,
                    " ".join(map(str, e.key_paras or [])), e.reviewer_name, e.reviewer_enrolment,
                    e.verified_at.isoformat() if e.verified_at else ""])
    return buf.getvalue()


def label_for(act: str) -> str:
    return SHORT.get(act, act)
