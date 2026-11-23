from __future__ import annotations

import copy
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import audit, get_firm_id, get_matter_or_404
from ..models import CitationCheck
from ..serializers import citation_check_dict
from ..services import citations as cit
from ..services.ai import firm_llm
from ..deps import require_role
from ..models import User
from ..services.ocr import OCRUnavailable, UnsupportedFile, extract_text

router = APIRouter(tags=["citations"])


class CheckIn(BaseModel):
    text: str
    matter_id: Optional[int] = None


class Confirm(BaseModel):
    actor: str = "advocate"


def _run(db: Session, firm_id: int, text: str, matter_id: Optional[int], on_item=None) -> dict:
    if not text.strip():
        raise HTTPException(422, "Empty draft")
    if matter_id:
        get_matter_or_404(db, firm_id, matter_id)
    llm = firm_llm(db, firm_id, "support")
    items = cit.check_text(text, cit.get_index(), llm, on_item=on_item)
    row = CitationCheck(firm_id=firm_id, matter_id=matter_id, source_text=text, items=items,
                        method="llm" if llm.available else "rules")
    db.add(row)
    db.flush()
    audit(db, firm_id, "system", "citation_check", "citation_check", row.id, {"citations": len(items)})
    db.commit()
    return citation_check_dict(row, cit.summarize(items))


@router.post("/citations/check", status_code=201)
def check(body: CheckIn, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    return _run(db, firm_id, body.text, body.matter_id)


@router.post("/citations/check-file", status_code=201)
async def check_file(file: UploadFile = File(...), matter_id: Optional[int] = Form(None),
                     db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    try:
        text, _ = extract_text(file.filename or "", await file.read())
    except (UnsupportedFile, OCRUnavailable) as exc:
        raise HTTPException(422, str(exc))
    return _run(db, firm_id, text, matter_id)


def _get(db: Session, firm_id: int, check_id: int) -> CitationCheck:
    row = db.get(CitationCheck, check_id)
    if not row or row.firm_id != firm_id:
        raise HTTPException(404, "Citation check not found")
    return row


@router.get("/citations/{check_id}")
def get_check(check_id: int, db: Session = Depends(get_db), firm_id: int = Depends(get_firm_id)):
    row = _get(db, firm_id, check_id)
    return citation_check_dict(row, cit.summarize(row.items))


@router.post("/citations/{check_id}/items/{index}/confirm")
def confirm_item(check_id: int, index: int, body: Confirm = Confirm(), db: Session = Depends(get_db),
                 firm_id: int = Depends(get_firm_id), user: User = Depends(require_role("advocate"))):
    """An advocate states they have read the authority themselves. Recorded in the audit log."""
    row = _get(db, firm_id, check_id)
    items = copy.deepcopy(row.items)
    if not 0 <= index < len(items):
        raise HTTPException(404, "No such citation in this check")
    items[index]["advocate_confirmed"] = True
    items[index]["confirmed_by"] = user.name + (f" ({user.enrolment_no})" if user.enrolment_no else "")
    row.items = items  # reassign so the JSON column is saved
    audit(db, firm_id, user.email, "confirm_citation", "citation_check", row.id,
          {"index": index, "citation": items[index]["citation"], "status_at_confirmation": items[index]["status"]})
    db.commit()
    return citation_check_dict(row, cit.summarize(items))
