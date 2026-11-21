"""iCalendar (.ics) export of hearings, statutory deadlines and approved tasks.

All events are all-day events, so there are no time-zone surprises. Deadlines carry reminders at the alert
days from the playbook. The same data feeds the in-app calendar; nothing here is calculated again.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Deadline, Firm, Matter, Task
from . import playbook as pbk

CRLF = "\r\n"


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r\n", "\n").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: lines are at most 75 octets; continuation lines start with one space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode("utf-8"))
        limit = 75 if not out else 74  # a continuation line spends one octet on its leading space
        if size + n > limit:
            out.append(cur)
            cur, size = ch, n
        else:
            cur += ch
            size += n
    out.append(cur)
    return (CRLF + " ").join(out)


def _d(x: date) -> str:
    return x.strftime("%Y%m%d")


def collect(db: Session, firm_id: int, matter_id: Optional[int] = None, today: Optional[date] = None) -> list:
    today = today or date.today()
    since = today - timedelta(days=30)
    q = db.query(Matter).filter(Matter.firm_id == firm_id, Matter.status != "closed")
    if matter_id:
        q = q.filter(Matter.id == matter_id)
    matters = {m.id: m for m in q}
    ev: list = []

    for m in matters.values():
        if m.next_date and m.next_date >= since:
            where = " · ".join(x for x in (m.court, m.case_number) if x)
            desc = [f"Matter: {m.title}"] + ([f"Court: {where}"] if where else []) + \
                   ([f"Client: {m.client_name}"] if m.client_name else [])
            try:
                prep = pbk.plan(pbk.get_playbook(m.case_type), m.current_stage)["current_actions"]
                if prep:
                    desc.append("Prepare: " + "; ".join(prep[:3]))
            except pbk.UnknownCaseType:
                pass
            ev.append({"uid": f"nyaay-hearing-{m.id}-{_d(m.next_date)}@nyaay", "date": m.next_date, "kind": "hearing",
                       "summary": f"Hearing: {m.title}", "description": "\n".join(desc), "alarms": [1],
                       "categories": "Hearing"})

    for d in db.query(Deadline).filter(Deadline.firm_id == firm_id, Deadline.status == "computed",
                                       Deadline.due_date.isnot(None), Deadline.due_date >= since):
        m = matters.get(d.matter_id)
        if not m:
            continue
        try:
            if pbk.deadline_met(pbk.get_playbook(m.case_type), d.rule_id, m.current_stage):
                continue
        except pbk.UnknownCaseType:
            pass
        short = d.label.split(" (")[0]
        desc = [f"Matter: {m.title}", d.label, f"Authority: {d.authority}" if d.authority else "",
                "Computed by fixed rules from the dates you confirmed. Confirm the date before relying on it."]
        if d.original_due_date and d.original_due_date != d.due_date:
            desc.append(f"Moved from {d.original_due_date:%d %b %Y}: the court is closed that day.")
        ev.append({"uid": f"nyaay-deadline-{m.id}-{d.rule_id}@nyaay", "date": d.due_date, "kind": "deadline",
                   "summary": f"Deadline: {short} ({m.title})", "description": "\n".join(x for x in desc if x),
                   "alarms": sorted(set(int(a) for a in (d.alert_days_before or []) if int(a) >= 0)) or [1],
                   "categories": "Deadline"})

    for t in db.query(Task).filter(Task.firm_id == firm_id, Task.status == "approved", Task.due_date.isnot(None),
                                   Task.due_date >= since):
        m = matters.get(t.matter_id)
        if m and t.action is None:
            ev.append({"uid": f"nyaay-task-{t.id}@nyaay", "date": t.due_date, "kind": "task",
                       "summary": f"To do: {t.title[:120]} ({m.title})", "description": f"Matter: {m.title}\n{t.detail or ''}".strip(),
                       "alarms": [], "categories": "Task"})
    ev.sort(key=lambda e: (e["date"], e["kind"], e["uid"]))
    return ev


def render(events: list, name: str, now: Optional[datetime] = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nyaay//Chambers calendar//EN", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_esc(name)}", "X-WR-TIMEZONE:Asia/Kolkata",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    for e in events:
        lines += ["BEGIN:VEVENT", f"UID:{e['uid']}", f"DTSTAMP:{stamp}",
                  f"DTSTART;VALUE=DATE:{_d(e['date'])}", f"DTEND;VALUE=DATE:{_d(e['date'] + timedelta(days=1))}",
                  f"SUMMARY:{_esc(e['summary'])}", f"DESCRIPTION:{_esc(e['description'])}",
                  f"CATEGORIES:{_esc(e['categories'])}", "TRANSP:TRANSPARENT"]
        for n in e["alarms"]:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(e['summary'])}", f"TRIGGER:-P{n}D", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return CRLF.join(_fold(x) for x in lines) + CRLF


def calendar_name(db: Session, firm_id: int, matter: Optional[Matter] = None) -> str:
    f = db.get(Firm, firm_id)
    return f"Nyaay: {matter.title}" if matter else f"Nyaay: {f.name if f else 'Chambers'}"
