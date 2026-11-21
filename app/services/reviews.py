"""Advocate sign-off on the legal content the product relies on: playbook deadline rules, stages, templates.

Each item has a version (hash of its content). A sign-off applies to that version only: if the rule or
template text changes, it shows as 'outdated' until an advocate reviews it again.
"""
from __future__ import annotations

import hashlib
import json

from sqlalchemy.orm import Session

from ..models import Review
from . import drafting as dft
from . import playbook as pbk


def _v(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def catalogue() -> list:
    pb = pbk.get_playbook("ni138")
    items = []
    for r in pb["deadline_rules"]:
        items.append({"kind": "rule", "ref": r["rule_id"], "label": r["label"], "group": pb["name"],
                      "detail": f"{r['authority']} · from {r['starts_from'].replace('_', ' ')} + "
                                f"{', '.join(f'{v} {k}' for k, v in r['add'].items())}"
                                + (" · moved to next open court day if closed" if r.get("court_act") else ""),
                      "version": _v(r)})
    for st in pb["stages"]:
        items.append({"kind": "stage", "ref": st["id"], "label": st["name"], "group": pb["name"],
                      "detail": " · ".join(st["actions"]), "version": _v(st)})
    for rt in pb.get("routes", []):
        items.append({"kind": "route", "ref": rt["id"], "label": rt["name"], "group": f"{pb['name']} · route options",
                      "detail": rt["summary"], "version": _v(rt)})
    for tid, t in dft.TEMPLATES.items():
        items.append({"kind": "template", "ref": tid, "label": t["name"], "group": "Draft templates",
                      "detail": dft.TEMPLATE_TEXT[tid][:600], "version": dft.template_version(tid)})
    return items


def status_map(db: Session, firm_id: int) -> dict:
    """(kind, ref) -> {status, reviewer, at, comment, outdated}"""
    cur = {(i["kind"], i["ref"]): i["version"] for i in catalogue()}
    out = {}
    for r in db.query(Review).filter(Review.firm_id == firm_id).order_by(Review.id):
        key = (r.kind, r.ref)
        if key not in cur:
            continue
        out[key] = {"status": r.status if r.version == cur[key] else "outdated", "reviewer": r.reviewer_name,
                    "enrolment": r.reviewer_enrolment, "at": r.created_at.isoformat(), "comment": r.comment}
    return out


def status_of(db: Session, firm_id: int, kind: str, ref: str) -> str:
    return status_map(db, firm_id).get((kind, ref), {}).get("status", "unreviewed")
