"""One path for every court order, however it arrives (upload, paste, WhatsApp, eCourts sync).

Text extraction order: text layer -> local OCR -> AI transcription (scanned or regional-language orders).
The same order text is never processed twice for a matter.
"""
from __future__ import annotations

import hashlib
from typing import Optional

from sqlalchemy.orm import Session

from ..deps import audit
from ..models import Matter, Order
from . import playbook as pbk
from .ai import firm_llm
from .ocr import NoTextFound, OCRUnavailable, UnsupportedFile, extract
from .order_reader import read_order

MEDIA = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp"}


class IntakeError(ValueError):
    pass


def _vision_fn(llm):
    """A page-image reader from the AI provider, or None when it cannot read images."""
    if not getattr(llm, "available", False) or getattr(llm, "name", "") == "none":
        return None
    if getattr(llm, "name", "") == "ollama" and not getattr(llm, "vision", ""):
        return None
    return lambda png: llm.transcribe(png, "image/png")


def file_to_text(db: Session, firm_id: int, filename: str, data: bytes) -> tuple:
    """(text, method, ocr_summary). Text layer, then Tesseract, then the AI vision model; says how far to trust it."""
    ext = "." + (filename or "").lower().rsplit(".", 1)[-1]
    llm = firm_llm(db, firm_id, "transcribe")
    try:
        r = extract(filename, data, vision=_vision_fn(llm))
        return r.text.replace("\x0c", "\n"), r.method, r.summary() | {"_pages": r.pages}
    except UnsupportedFile as exc:
        if not isinstance(exc, NoTextFound):
            raise IntakeError(str(exc))
        first = exc
    except Exception as exc:  # OCR missing, unreadable image, broken PDF ...
        first = exc
    if ext in MEDIA and llm.available and getattr(llm, "name", "") != "ollama":   # e.g. Claude reads a PDF directly
        try:
            text = llm.transcribe(data, MEDIA[ext])
        except Exception as e2:
            raise IntakeError(f"Could not read the file ({type(first).__name__}); AI transcription also failed "
                              f"({type(e2).__name__}).")
        if len(text.strip()) >= 20:
            return text, "ai-transcription", {"method": "ai-transcription", "confidence": None, "pages": 0,
                                              "low_confidence_pages": [], "warnings": [], "_pages": []}
    msg = str(first) if isinstance(first, (NoTextFound, OCRUnavailable)) else \
        f"Could not read this file ({type(first).__name__})."
    raise IntakeError(msg)


def intake(db: Session, firm_id: int, m: Matter, *, text: Optional[str] = None, data: Optional[bytes] = None,
           filename: Optional[str] = None, language: str = "en", source: str = "upload") -> dict:
    from ..routes.orders import propose_tasks  # shared task rules

    method, ocr_info, low_pages = "pasted", None, []
    if data is not None and filename:
        text, method, ocr_info = file_to_text(db, firm_id, filename, data)
        low_pages = ocr_info.pop("_pages", [])
    if not text or not text.strip():
        raise IntakeError("Provide the order as a file or as pasted text.")
    h = hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()
    dup = db.query(Order).filter(Order.matter_id == m.id, Order.text_hash == h).first()
    if dup:
        return {"order": dup, "tasks": [], "duplicate": True, "ocr": ocr_info}
    pb = pbk.get_playbook(m.case_type)
    r = read_order(text, pb, firm_llm(db, firm_id, "order"), matter_title=m.title, client_name=m.client_name,
                   language=language)
    if method in ("ocr", "ai-transcription"):
        notes = []
        for pg in low_pages:
            if pg.low:
                notes.append(f"Page {pg.page} was read with low confidence"
                             + (f" ({pg.confidence:.0f}%)" if pg.confidence is not None else " (AI transcription)")
                             + ". Check it against the original.")
        conf = ocr_info.get("confidence") if ocr_info else None
        head = (f"Text came from OCR (average confidence {conf:.0f}%). " if method == "ocr" and conf is not None
                else f"Text came from {'OCR' if method == 'ocr' else 'AI transcription of a scan'}. ")
        r["needs_review"] = [head + "Check dates and names against the original."] + notes + \
            [w for w in (ocr_info or {}).get("warnings", [])] + list(r["needs_review"])
    o = Order(firm_id=firm_id, matter_id=m.id, filename=filename, text=text, order_date=r["order_date"],
              next_date=r["next_date"], summary=r["summary"], directions=r["directions"],
              detected_stage=r["detected_stage"], stage_confidence=r["stage_confidence"],
              extraction_method=r["extraction_method"] if method not in ("ocr", "ai-transcription")
              else f"{method}+{r['extraction_method']}", needs_review=r["needs_review"],
              client_message=r["client_message"], source=source, text_hash=h)
    db.add(o)
    db.flush()
    tasks = propose_tasks(db, firm_id, m, o, pb, r["matched_keywords"])
    audit(db, firm_id, "system", "read_order", "order", o.id, {"method": r["extraction_method"], "source": source})
    db.commit()
    return {"order": o, "tasks": tasks, "duplicate": False, "ocr": ocr_info}
