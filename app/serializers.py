from __future__ import annotations

from .models import Bookmark, CitationCheck, Deadline, Draft, Matter, Note, Order, Task


def _d(x):
    return x.isoformat() if x else None


def matter_dict(m: Matter) -> dict:
    return {"id": m.id, "title": m.title, "case_type": m.case_type, "court": m.court,
            "case_number": m.case_number, "cnr": m.cnr, "client_name": m.client_name, "goal": m.goal,
            "current_stage": m.current_stage, "facts": m.facts or {}, "details": m.details or {}, "next_date": _d(m.next_date),
            "status": m.status, "created_at": _d(m.created_at), "synced_at": _d(m.synced_at),
            "sync_status": m.sync_status}


def order_dict(o: Order, with_text: bool = False) -> dict:
    out = {"id": o.id, "matter_id": o.matter_id, "filename": o.filename, "order_date": _d(o.order_date),
           "next_date": _d(o.next_date), "summary": o.summary, "directions": o.directions,
           "detected_stage": o.detected_stage, "stage_confidence": o.stage_confidence,
           "extraction_method": o.extraction_method, "needs_review": o.needs_review,
           "client_message": o.client_message, "source": o.source or "upload", "created_at": _d(o.created_at)}
    if with_text:
        out["text"] = o.text
    return out


def task_dict(t: Task) -> dict:
    return {"id": t.id, "matter_id": t.matter_id, "title": t.title, "detail": t.detail,
            "due_date": _d(t.due_date), "source": t.source, "status": t.status, "action": t.action,
            "payload": t.payload, "decided_by": t.decided_by, "decided_at": _d(t.decided_at),
            "created_at": _d(t.created_at)}


def deadline_dict(d: Deadline) -> dict:
    return {"id": d.id, "matter_id": d.matter_id, "rule_id": d.rule_id, "label": d.label,
            "authority": d.authority, "due_date": _d(d.due_date), "status": d.status,
            "needs_confirmation": d.needs_confirmation, "alert_days_before": d.alert_days_before,
            "note": d.note, "original_due_date": _d(getattr(d, "original_due_date", None))}


def citation_check_dict(c: CitationCheck, summary: dict) -> dict:
    return {"id": c.id, "matter_id": c.matter_id, "method": c.method, "items": c.items,
            "summary": summary, "created_at": _d(c.created_at)}


def note_dict(n: Note) -> dict:
    return {"id": n.id, "matter_id": n.matter_id, "body": n.body, "author": n.author, "created_at": _d(n.created_at)}


def bookmark_dict(b: Bookmark) -> dict:
    return {"id": b.id, "matter_id": b.matter_id, "jid": b.jid, "title": b.title, "citation": b.citation,
            "para_no": b.para_no, "excerpt": b.excerpt, "note": b.note, "created_at": _d(b.created_at)}


def draft_dict(d: Draft, with_body: bool = True) -> dict:
    out = {"id": d.id, "matter_id": d.matter_id, "template": d.template, "title": d.title, "status": d.status,
           "created_at": _d(d.created_at), "updated_at": _d(d.updated_at)}
    if with_body:
        out["body"] = d.body
    return out
