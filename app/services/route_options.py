"""Route options from the playbook. Deadlines come from the playbook's fixed rules (never from a model).

Every route stays a DRAFT until an advocate has signed off its current version (reviews, kind 'route').
What-if dates are computed on the fly and never saved to the matter.
"""
from __future__ import annotations

from datetime import date

from . import playbook as pbk


def _facts(matter_facts: dict, what_if: dict) -> dict:
    out = {}
    for k, v in {**(matter_facts or {}), **what_if}.items():
        try:
            out[k] = v if isinstance(v, date) else date.fromisoformat(v)
        except (TypeError, ValueError):
            continue
    return out


def options(pb: dict, matter_facts: dict, what_if: dict, review_status: dict, today: date | None = None) -> list[dict]:
    """review_status: route id -> 'approved'|'changes_requested'|'outdated'|'unreviewed'."""
    today = today or date.today()
    base = pbk.compute_deadlines(pb, _facts(matter_facts, {}))
    hypo = pbk.compute_deadlines(pb, _facts(matter_facts, what_if)) if what_if else base
    base_by = {d.rule_id: d for d in base}
    hypo_by = {d.rule_id: d for d in hypo}
    out = []
    for rt in pb.get("routes", []):
        dls = []
        for rid in rt.get("deadline_rules", []):
            h, b = hypo_by.get(rid), base_by.get(rid)
            if not h:
                continue
            dls.append({"rule_id": rid, "label": h.label, "authority": h.authority,
                        "due_date": h.due_date.isoformat() if h.due_date else None,
                        "saved_due_date": b.due_date.isoformat() if b and b.due_date else None,
                        "days_left": (h.due_date - today).days if h.due_date else None,
                        "changed_by_what_if": bool(what_if) and (h.due_date != (b.due_date if b else None)),
                        "note": h.note if h.status == "missing_input" else ""})
        st = review_status.get(rt["id"], "unreviewed")
        out.append({"id": rt["id"], "name": rt["name"], "summary": rt["summary"], "steps": rt["steps"],
                    "consider": rt.get("consider", []), "risks": rt.get("risks", []),
                    "authority": rt.get("authority", ""), "what_if_inputs": rt.get("what_if", []),
                    "deadlines": dls, "review": st, "draft": st != "approved"})
    return out
