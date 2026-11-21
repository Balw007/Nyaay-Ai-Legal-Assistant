"""System check and the legal review pack, for the Settings screen."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import doctor, review_pack
from ..db import get_db
from ..deps import require_role
from ..models import User

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/check")
async def system_check(full: bool = False, user: User = Depends(require_role("admin"))):
    """Runs the same checks as `python -m app.doctor`. full=true also tests the AI models and downloads one real
    judgment from the open-data bucket, which takes a minute or more."""
    results = await run_in_threadpool(doctor.run_checks, not full, False)
    return {"results": results, "summary": doctor.summarise(results), "full": full}


@router.get("/review-pack")
def review_pack_download(format: str = "docx", user: User = Depends(require_role("advocate")),
                         db: Session = Depends(get_db)):
    """The rules and templates in one document for an advocate to review and sign."""
    if format not in {"docx", "md"}:
        raise HTTPException(422, "format must be docx or md")
    data, media, name = review_pack.render(format, db, user.firm_id)
    return Response(content=data, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})
