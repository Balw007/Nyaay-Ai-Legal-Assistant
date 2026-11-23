"""Agents: background AI work that a person can watch, inspect and stop.

Each agent wraps an existing, tested Nyaay service. It adds no new legal logic, only orchestration and an honest record:
- research  -> services.research.ask        (retrieve paragraphs, write a cited answer, check every reference)
- judgment  -> services.research.summarize  (headnote: issues, holding, key paragraphs)
- citation  -> routes.citations._run        (find, match and verify every citation in a draft; saved as a check)
- drafting  -> services.drafting.polish     (suggested wording; never applied to the draft)

Work runs one task at a time (a local model on a laptop cannot usefully run two at once), so a task waits as "queued"
until the one before it finishes. Progress is a number only when the work is countable (citations checked); while
the model is writing, the task is marked indeterminate rather than showing an invented percentage.
"""
from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import AgentTask, Draft, User, utcnow

CATALOG = {
    "research": {
        "name": "Research Agent",
        "does": "Finds the paragraphs in your library that answer a question, writes an answer that cites them, and "
                "checks every reference against the paragraph it cites.",
        "engine": ["Library search", "Local AI"],
        "without_ai": "Returns the most relevant paragraphs without a written answer.",
    },
    "judgment": {
        "name": "Judgment Analysis Agent",
        "does": "Reads one judgment and drafts a headnote: the issues, what was held, the result and the key paragraphs.",
        "engine": ["Local AI"],
        "without_ai": "Unavailable: a headnote needs the local AI.",
    },
    "citation": {
        "name": "Citation Verification Agent",
        "does": "Finds every citation in a draft, matches it to your library, finds the paragraph, and asks the local "
                "AI only whether that paragraph supports the point. Saved as a citation check.",
        "engine": ["Fixed rules", "Local AI"],
        "without_ai": "Matches citations, but none can be marked Verified until the AI runs or an advocate confirms it.",
    },
    "drafting": {
        "name": "Drafting Agent",
        "does": "Suggests clearer wording for a draft. Blocked automatically if it drops a blank or adds a citation or "
                "a number. The draft is never changed until you accept the suggestion.",
        "engine": ["Local AI", "Fixed rules"],
        "without_ai": "Unavailable: drafting suggestions need the local AI.",
    },
}

_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="agent")
_recovered = False
_lock = threading.Lock()


class Cancelled(Exception):
    pass


def task_dict(t: AgentTask) -> dict:
    return {
        "id": t.id, "agent": t.agent, "agent_name": CATALOG.get(t.agent, {}).get("name", t.agent), "title": t.title,
        "input": t.input, "matter_id": t.matter_id, "status": t.status, "progress": t.progress,
        "indeterminate": t.indeterminate, "step": t.step, "steps": t.steps or [], "result": t.result,
        "error": t.error, "cancel_requested": t.cancel_requested, "user_name": t.user_name,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
        "needs_review": t.status == "done",
    }


def recover(db: Session) -> None:
    """Tasks that were queued or running when Nyaay last stopped did not finish. Say so instead of showing them as live."""
    global _recovered
    with _lock:
        if _recovered:
            return
        _recovered = True
    stale = db.query(AgentTask).filter(AgentTask.status.in_(("queued", "running"))).all()
    for t in stale:
        t.status, t.error, t.indeterminate, t.finished_at = "failed", "Stopped because Nyaay was restarted.", False, utcnow()
    if stale:
        db.commit()


def _title(agent: str, data: dict) -> str:
    if agent == "research":
        return data.get("question", "")[:280]
    if agent == "judgment":
        return data.get("title") or data.get("jid", "")
    if agent == "citation":
        return data.get("title") or "Citations in a draft"
    if agent == "drafting":
        return data.get("title") or f"Draft {data.get('draft_id')}"
    return agent


def validate(db: Session, firm_id: int, agent: str, data: dict) -> dict:
    from ..services.store import get_store

    if agent not in CATALOG:
        raise ValueError("Unknown agent")
    if agent == "research":
        q = str(data.get("question", "")).strip()
        if len(q) < 5:
            raise ValueError("Ask a full question")
        return {"question": q, **{k: data.get(k) for k in ("jid", "court", "year_from", "year_to") if data.get(k)}}
    if agent == "judgment":
        jid = str(data.get("jid", ""))
        j = get_store().get_judgment(jid)
        if not j:
            raise ValueError("Judgment not found")
        return {"jid": jid, "title": j["title"]}
    if agent == "citation":
        text = str(data.get("text", ""))
        if not text.strip():
            raise ValueError("Paste the draft text to check")
        return {"text": text, "title": str(data.get("title") or "")[:200], "matter_id": data.get("matter_id")}
    if agent == "drafting":
        d = db.query(Draft).filter(Draft.firm_id == firm_id, Draft.id == int(data.get("draft_id") or 0)).first()
        if not d:
            raise ValueError("Draft not found")
        return {"draft_id": d.id, "title": d.title}
    raise ValueError("Unknown agent")


def start(db: Session, user: User, agent: str, data: dict) -> AgentTask:
    recover(db)
    clean = validate(db, user.firm_id, agent, data)
    t = AgentTask(firm_id=user.firm_id, user_id=user.id, user_name=user.name, agent=agent, title=_title(agent, clean),
                  input=clean, matter_id=clean.get("matter_id"), status="queued", step="Waiting for the agent before it",
                  steps=[{"at": utcnow().isoformat(), "text": "Queued"}])
    db.add(t)
    db.commit()
    db.refresh(t)
    _pool.submit(_run, t.id)
    return t


class _Ctx:
    def __init__(self, db: Session, t: AgentTask):
        self.db, self.t = db, t

    def step(self, text: str, progress: Optional[int] = None, indeterminate: bool = False) -> None:
        self.db.refresh(self.t)
        if self.t.cancel_requested:
            raise Cancelled()
        self.t.step, self.t.indeterminate = text[:300], indeterminate
        if progress is not None:
            self.t.progress = max(0, min(100, int(progress)))
        self.t.steps = [*(self.t.steps or []), {"at": utcnow().isoformat(), "text": text[:300]}][-40:]
        self.db.commit()


def _run(task_id: int) -> None:
    db = SessionLocal()
    try:
        t = db.get(AgentTask, task_id)
        if not t or t.status != "queued":
            return
        if t.cancel_requested:
            t.status, t.finished_at, t.step = "cancelled", utcnow(), "Cancelled before it started"
            db.commit()
            return
        t.status, t.started_at = "running", utcnow()
        db.commit()
        ctx = _Ctx(db, t)
        try:
            result = HANDLERS[t.agent](db, t, ctx)
            db.refresh(t)
            t.status, t.result, t.progress, t.indeterminate, t.finished_at = "done", result, 100, False, utcnow()
            t.steps = [*(t.steps or []), {"at": utcnow().isoformat(), "text": "Finished. Waiting for your review."}]
            t.step = "Finished. Waiting for your review."
        except Cancelled:
            db.rollback()
            t = db.get(AgentTask, task_id)
            t.status, t.indeterminate, t.finished_at, t.step = "cancelled", False, utcnow(), "Stopped at your request"
        except Exception as exc:  # the record must say what happened, never pretend success
            db.rollback()
            t = db.get(AgentTask, task_id)
            t.status, t.indeterminate, t.finished_at = "failed", False, utcnow()
            t.error = str(exc)[:500] or type(exc).__name__
            t.step = "Failed"
        db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------------------------- handlers

def _research(db: Session, t: AgentTask, ctx: _Ctx) -> dict:
    from ..services import research as rs
    from ..services.ai import firm_llm
    from ..services.store import get_store

    d = t.input
    store = get_store()
    llm = firm_llm(db, t.firm_id, "answer", t.user_id)
    ctx.step("Searching your library for relevant paragraphs", 10)
    found = rs.retrieve(store, d["question"], jid=d.get("jid"), court=d.get("court"), year_from=d.get("year_from"),
                        year_to=d.get("year_to"), llm=None, rerank=False)
    ctx.step(f"Found {len(found)} candidate paragraphs", 30)
    if found and llm.available:
        ctx.step("Writing an answer that cites the paragraphs (local AI)", 40, indeterminate=True)
    out = rs.ask(store, llm, d["question"], jid=d.get("jid"), court=d.get("court"), year_from=d.get("year_from"),
                 year_to=d.get("year_to"))
    if out.get("mode") == "answer":
        checks = out.get("checks") or {}
        ctx.step(f"Checked references: {len(checks.get('cited_sources', []))} sources cited, "
                 f"{len(checks.get('uncited_sentences', []))} sentences without a source", 95)
    else:
        ctx.step(out.get("message") or "No written answer", 95)
    return out


def _judgment(db: Session, t: AgentTask, ctx: _Ctx) -> dict:
    from ..services import research as rs
    from ..services.ai import firm_llm
    from ..services.store import get_store

    llm = firm_llm(db, t.firm_id, "summary", t.user_id)
    ctx.step("Reading the opening and closing paragraphs", 15)
    if llm.available:
        ctx.step("Drafting the headnote (local AI)", 30, indeterminate=True)
    out = rs.summarize(get_store(), llm, t.input["jid"])
    if out.get("mode") in ("none", "failed"):
        raise RuntimeError(out.get("message") or "No headnote")
    if out.get("mode") == "not_found":
        raise RuntimeError("Judgment not found")
    out["jid"] = t.input["jid"]
    ctx.step(f"Headnote ready: {len(out.get('key_paragraphs') or [])} key paragraphs, all checked against the judgment", 95)
    return out


def _citation(db: Session, t: AgentTask, ctx: _Ctx) -> dict:
    from ..routes.citations import _run as run_check

    ctx.step("Finding citations in the draft", 5)

    def on_item(i: int, total: int, raw: str) -> None:
        ctx.step(f"Checking {i + 1} of {total}: {raw}", 5 + int(90 * i / max(1, total)))

    out = run_check(db, t.firm_id, t.input["text"], t.input.get("matter_id"), on_item=on_item)
    s = out.get("summary") or {}
    ctx.step(f"Checked {s.get('total', 0)} citations. Saved as citation check {out.get('id')}", 98)
    return {"check_id": out.get("id"), "summary": s,
            "statuses": [{"citation": i["citation"], "status": i["status"]} for i in out.get("items", [])]}


def _drafting(db: Session, t: AgentTask, ctx: _Ctx) -> dict:
    from ..services import drafting as dft
    from ..services.ai import firm_llm

    llm = firm_llm(db, t.firm_id, "polish", t.user_id)
    if not llm.available:
        raise RuntimeError("The local AI is not running, so no wording can be suggested. Start Ollama and try again.")
    d = db.query(Draft).filter(Draft.firm_id == t.firm_id, Draft.id == t.input["draft_id"]).first()
    if not d:
        raise RuntimeError("Draft not found")
    ctx.step("Suggesting clearer wording (local AI)", 20, indeterminate=True)
    out = dft.polish(d.body, llm)
    ctx.step("Checked the suggestion: blanks, citations and numbers" + (" (problems found, blocked)" if out["problems"] else " unchanged"), 95)
    return {"draft_id": d.id, "changes": out["changes"], "problems": out["problems"], "accepted": out["accepted"],
            "body": out["body"]}


HANDLERS: dict[str, Callable[[Session, AgentTask, _Ctx], dict]] = {
    "research": _research, "judgment": _judgment, "citation": _citation, "drafting": _drafting,
}


def wait(task_id: int, timeout: float = 20.0) -> None:
    """For tests: block until the task leaves queued/running."""
    import time

    end = time.time() + timeout
    while time.time() < end:
        db = SessionLocal()
        try:
            t = db.get(AgentTask, task_id)
            if t and t.status not in ("queued", "running"):
                return
        finally:
            db.close()
        time.sleep(0.05)
