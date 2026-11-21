"""Hearing notes -> proposed tasks. Dates must appear in the note itself; a model never supplies one."""
from __future__ import annotations

import re
from datetime import date

from . import order_reader as orr

ACTION_RE = re.compile(
    r"\b(to\s+(?:file|submit|produce|serve|issue|reply|bring|collect|obtain|arrange|prepare|draft|send|call|"
    r"verify|summon|pay|deposit|appear|examine|cross[- ]examine)|"
    r"file|submit|produce|serve|reply|affidavit|compliance|written statement|documents? (?:to be|required)|"
    r"call (?:the )?client|bring|collect|obtain|prepare|draft|deposit|pay|summon)\b", re.I)
SPLIT_RE = re.compile(r"(?:\r?\n|(?<=[.;!?])\s+)")


def _grounded(text: str) -> set[date]:
    return {d for d, _, _ in orr.find_dates(text)}


def rule_tasks(text: str) -> list[dict]:
    out = []
    for raw in SPLIT_RE.split(text):
        s = re.sub(r"^[\s\-*•\d.)]+", "", raw).strip()
        if len(s) < 12 or not ACTION_RE.search(s):
            continue
        ds = [d for d, _, _ in orr.find_dates(s)]
        out.append({"title": s[:200], "due_date": ds[0] if ds else None})
    return out[:10]


SYSTEM = ("You turn an advocate's hearing notes into follow-up tasks. Use only the text given. Reply with one JSON "
          "object: {\"tasks\": [{\"title\": str (max 120 chars, imperative), \"due_date\": \"YYYY-MM-DD\" or null}]}. "
          "Only give a due_date if that exact date is written in the notes. Do not invent tasks, names or dates.")


def extract(text: str, hearing_date: date | None, llm) -> dict:
    ground = _grounded(text)
    next_date = orr.find_next_date(text, hearing_date)
    tasks, method, review = [], "rules", []
    if llm is not None and llm.available:
        try:
            data = llm.json(SYSTEM, text[:8000], max_tokens=900)
            for t in data.get("tasks", [])[:10]:
                title = str(t.get("title") or "").strip()[:200]
                if not title:
                    continue
                due = None
                try:
                    due = date.fromisoformat(t["due_date"]) if t.get("due_date") else None
                except (TypeError, ValueError):
                    pass
                if due and due not in ground:
                    review.append(f"Dropped a date the model gave that is not in the notes ({due:%d %b %Y}).")
                    due = None
                tasks.append({"title": title, "due_date": due})
            method = "ai"
        except Exception as exc:
            review.append(f"The AI step failed ({type(exc).__name__}); used plain rules instead.")
    if not tasks:
        tasks = rule_tasks(text)
    return {"tasks": tasks, "next_date": next_date, "method": method, "needs_review": review}
