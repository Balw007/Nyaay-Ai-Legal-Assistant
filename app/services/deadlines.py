"""Statutory deadlines for a matter, adjusted for court closures.

Section 10 of the General Clauses Act, 1897: where an act is to be done in a court or office on a day it is
closed, the act is in time if done on the next day it is open. This applies only to acts done IN court
(e.g. filing the complaint) — rules marked "court_act" in the playbook. It does not move the notice period
or the drawer's payment period.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..models import CourtHoliday, Deadline, Firm, Matter
from . import playbook as pbk
from .ai import firm_settings


def _second_or_fourth_saturday(d: date) -> bool:
    return d.weekday() == 5 and ((d.day - 1) // 7 + 1) in (2, 4)


def closed_days(db: Session, firm_id: int, court: Optional[str]) -> set:
    rows = db.query(CourtHoliday).filter(CourtHoliday.firm_id == firm_id).all()
    c = (court or "").lower()
    return {h.day for h in rows if not h.court or (c and h.court.lower() in c)}


def is_closed(d: date, holidays: set, saturdays: str) -> Optional[str]:
    if d.weekday() == 6:
        return "Sunday"
    if saturdays == "all" and d.weekday() == 5:
        return "Saturday"
    if saturdays == "second_fourth" and _second_or_fourth_saturday(d):
        return "second/fourth Saturday"
    if d in holidays:
        return "court holiday"
    return None


def next_open_day(d: date, holidays: set, saturdays: str) -> tuple:
    reasons = []
    while (why := is_closed(d, holidays, saturdays)):
        reasons.append(f"{d:%d %b %Y} ({why})")
        d += timedelta(days=1)
    return d, reasons


def recompute(db: Session, m: Matter) -> list:
    """Replace the matter's deadline rows with freshly computed, holiday-adjusted ones."""
    pb = pbk.get_playbook(m.case_type)
    facts = {k: date.fromisoformat(v) for k, v in (m.facts or {}).items()}
    settings = firm_settings(db.get(Firm, m.firm_id))
    hol = closed_days(db, m.firm_id, m.court)
    court_act = {r["rule_id"] for r in pb["deadline_rules"] if r.get("court_act")}
    db.query(Deadline).filter(Deadline.matter_id == m.id).delete()
    rows = []
    for r in pbk.compute_deadlines(pb, facts):
        due, original, note = r.due_date, None, r.note
        if due and r.rule_id in court_act:
            adj, reasons = next_open_day(due, hol, settings["closed_saturdays"])
            if adj != due:
                original, due = due, adj
                note = (f"Moved from {original:%d %b %Y}: court closed on {', '.join(reasons)}. "
                        f"Section 10, General Clauses Act. ") + (note or "")
        rows.append(Deadline(firm_id=m.firm_id, matter_id=m.id, rule_id=r.rule_id, label=r.label,
                             authority=r.authority, due_date=due, status=r.status,
                             needs_confirmation=r.needs_confirmation, alert_days_before=r.alert_days_before,
                             note=note, original_due_date=original))
    db.add_all(rows)
    return rows


def recompute_firm(db: Session, firm_id: int) -> int:
    n = 0
    for m in db.query(Matter).filter(Matter.firm_id == firm_id):
        if m.facts:
            recompute(db, m)
            n += 1
    return n
