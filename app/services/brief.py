"""Morning brief: what is listed today, what is due soon, what needs approval."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from ..models import Deadline, Matter, Order, Task
from . import playbook as pbk


def build_brief(db: Session, firm_id: int, today: date) -> dict:
    matters = {m.id: m for m in db.query(Matter).filter(Matter.firm_id == firm_id, Matter.status == "active")}

    listed = []
    for m in matters.values():
        if m.next_date == today:
            try:
                prep = pbk.plan(pbk.get_playbook(m.case_type), m.current_stage)["current_actions"]
            except pbk.UnknownCaseType:
                prep = []
            listed.append({"matter_id": m.id, "title": m.title, "court": m.court,
                           "case_number": m.case_number, "prepare": prep})

    window_end = today + timedelta(days=7)
    deadlines = []
    for d in db.query(Deadline).filter(Deadline.firm_id == firm_id, Deadline.status == "computed"):
        if d.matter_id not in matters or d.due_date is None or d.due_date > window_end:
            continue
        mm = matters[d.matter_id]
        try:
            if pbk.deadline_met(pbk.get_playbook(mm.case_type), d.rule_id, mm.current_stage):
                continue
        except pbk.UnknownCaseType:
            pass
        deadlines.append({
            "matter_id": d.matter_id, "matter": matters[d.matter_id].title, "label": d.label,
            "authority": d.authority, "due_date": d.due_date.isoformat(),
            "overdue": d.due_date < today, "days_left": (d.due_date - today).days,
            "needs_confirmation": d.needs_confirmation,
        })
    deadlines.sort(key=lambda x: x["due_date"])

    since = datetime.combine(today - timedelta(days=1), datetime.min.time())
    new_orders = [{"matter_id": o.matter_id, "matter": matters[o.matter_id].title if o.matter_id in matters else "",
                   "summary": o.summary[:200], "next_date": o.next_date.isoformat() if o.next_date else None}
                  for o in db.query(Order).filter(Order.firm_id == firm_id, Order.created_at >= since)]

    pending = db.query(Task).filter(Task.firm_id == firm_id, Task.status == "proposed").count()
    return {"date": today.isoformat(), "listed_today": listed, "deadlines": deadlines,
            "new_orders": new_orders, "pending_approvals": pending}


def render_text(brief: dict) -> str:
    """Plain text for WhatsApp, Telegram or email."""
    lines = [f"Morning brief, {brief['date']}", ""]
    lines.append(f"Listed today ({len(brief['listed_today'])}):")
    for m in brief["listed_today"] or []:
        lines.append(f"- {m['title']}" + (f" ({m['court']})" if m.get("court") else ""))
        for p in m["prepare"][:2]:
            lines.append(f"    prepare: {p}")
    if not brief["listed_today"]:
        lines.append("- nothing listed")
    lines += ["", f"Deadlines in the next 7 days ({len(brief['deadlines'])}):"]
    for d in brief["deadlines"]:
        flag = "OVERDUE" if d["overdue"] else f"{d['days_left']}d left"
        lines.append(f"- [{flag}] {d['matter']}: {d['label']} on {d['due_date']} (confirm before relying)")
    if not brief["deadlines"]:
        lines.append("- none")
    lines += ["", f"New orders since yesterday: {len(brief['new_orders'])}",
              f"Waiting for your approval: {brief['pending_approvals']}"]
    return "\n".join(lines)
