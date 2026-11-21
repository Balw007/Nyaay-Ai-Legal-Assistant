"""Playbook engine.

A playbook is a case type's procedure written as data: stages, derived dates, fixed deadline rules and
suggested actions. Deadlines come from these rules in plain code. The LLM never calculates a date.
"""
from __future__ import annotations

import calendar
import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from functools import lru_cache

from ..config import DATA_DIR

PLAYBOOK_DIR = DATA_DIR / "playbooks"


class UnknownCaseType(KeyError):
    pass


@lru_cache(maxsize=None)
def get_playbook(case_type: str) -> dict:
    path = PLAYBOOK_DIR / f"{case_type}.json"
    if not path.exists():
        raise UnknownCaseType(case_type)
    return json.loads(path.read_text(encoding="utf-8"))


def available_case_types() -> list[str]:
    return sorted(p.stem for p in PLAYBOOK_DIR.glob("*.json"))


# ---------------------------------------------------------------- dates

def add_months(d: date, months: int) -> date:
    idx = d.month - 1 + months
    year, month = d.year + idx // 12, idx % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def add_period(d: date, period: dict) -> date:
    out = add_months(d, int(period.get("months", 0))) if period.get("months") else d
    return out + timedelta(days=int(period.get("days", 0)))


# ---------------------------------------------------------------- deadlines

@dataclass
class DeadlineResult:
    rule_id: str
    label: str
    authority: str
    due_date: date | None
    status: str  # computed | missing_input
    needs_confirmation: bool
    alert_days_before: list[int] = field(default_factory=list)
    note: str = ""


def input_names(pb: dict) -> set[str]:
    return {i["name"] for i in pb["inputs"]}


def _input_label(pb: dict, name: str) -> str:
    for i in pb["inputs"]:
        if i["name"] == name:
            return i["label"]
    return name


def compute_deadlines(pb: dict, facts: dict[str, date]) -> list[DeadlineResult]:
    """Pure function: facts in, deadlines out. Facts are dates the lawyer has confirmed."""
    resolved: dict[str, date] = dict(facts)
    for derived in pb.get("derived_dates", []):
        src = resolved.get(derived["from"])
        if src is not None:
            resolved[derived["name"]] = add_period(src, derived["add"])

    base_note = pb.get("deadline_note", "")
    results: list[DeadlineResult] = []
    for rule in pb["deadline_rules"]:
        start = resolved.get(rule["starts_from"])
        if start is None:
            root = _root_input(pb, rule["starts_from"])
            results.append(DeadlineResult(
                rule["rule_id"], rule["label"], rule.get("authority", ""), None, "missing_input", True,
                rule.get("alert_days_before", []), f"Needs: {_input_label(pb, root)}"))
        else:
            results.append(DeadlineResult(
                rule["rule_id"], rule["label"], rule.get("authority", ""), add_period(start, rule["add"]),
                "computed", True, rule.get("alert_days_before", []), base_note))
    return results


def _root_input(pb: dict, name: str) -> str:
    derived = {d["name"]: d["from"] for d in pb.get("derived_dates", [])}
    while name in derived:
        name = derived[name]
    return name


def is_alert_due(due: date, alert_days: list[int], today: date) -> bool:
    """True when the deadline is inside the widest alert window (or already past)."""
    if not alert_days:
        return False
    return (due - today).days <= max(alert_days)


# ---------------------------------------------------------------- stages

def detect_stage(pb: dict, text: str) -> tuple[str | None, float, list[str]]:
    """Keyword baseline. Returns (stage_id, confidence, matched keywords). Later stages win ties."""
    low = text.lower()
    best: tuple[int, int, str, list[str]] | None = None
    for idx, stage in enumerate(pb["stages"]):
        hits = [k for k in stage["keywords"] if k in low]
        if not hits:
            continue
        cand = (len(hits), idx, stage["id"], hits)
        if best is None or (cand[0], cand[1]) > (best[0], best[1]):
            best = cand
    if best is None:
        return None, 0.0, []
    return best[2], min(0.9, 0.45 + 0.15 * best[0]), best[3]


def stage_by_id(pb: dict, stage_id: str | None) -> dict | None:
    for s in pb["stages"]:
        if s["id"] == stage_id:
            return s
    return None


def plan(pb: dict, current_stage: str | None) -> dict:
    """Where the case is, what is left, and what to do now."""
    ids = [s["id"] for s in pb["stages"]]
    cur_idx = ids.index(current_stage) if current_stage in ids else -1
    stages = []
    for i, s in enumerate(pb["stages"]):
        state = "done" if i < cur_idx else "current" if i == cur_idx else "upcoming"
        stages.append({"id": s["id"], "name": s["name"], "state": state})
    focus = pb["stages"][cur_idx] if cur_idx >= 0 else pb["stages"][0]
    nxt = pb["stages"][cur_idx + 1] if 0 <= cur_idx + 1 < len(pb["stages"]) else None
    return {
        "playbook_status": pb["status"],
        "current_stage_name": pb["stages"][cur_idx]["name"] if cur_idx >= 0 else None,
        "progress": round((cur_idx + 1) / len(ids), 2) if cur_idx >= 0 else 0.0,
        "stages": stages,
        "current_actions": focus["actions"],
        "current_drafts": focus["drafts"],
        "next_stage": nxt["name"] if nxt else None,
        "next_stage_actions": nxt["actions"] if nxt else [],
    }


def deadline_met(pb: dict, rule_id: str, current_stage) -> bool:
    """True once the case has reached the stage that makes this deadline irrelevant (e.g. notice already sent)."""
    rule = next((r for r in pb["deadline_rules"] if r["rule_id"] == rule_id), None)
    if not rule or not rule.get("met_at_stage") or not current_stage:
        return False
    ids = [s["id"] for s in pb["stages"]]
    if current_stage not in ids or rule["met_at_stage"] not in ids:
        return False
    return ids.index(current_stage) >= ids.index(rule["met_at_stage"])
