"""Small lawyer tools that need no matter: the IPC/CrPC/Evidence Act to BNS/BNSS/BSA section converter."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from ..deps import get_user
from ..models import User
from ..services import converter

router = APIRouter(tags=["tools"])


@router.get("/tools/convert")
def convert(q: str = Query(..., min_length=1, max_length=120), _: User = Depends(get_user)):
    """'302 IPC', '438 CrPC', '65B Evidence Act', '103(1) BNS' ... Works both ways (old to new, new to old)."""
    return converter.lookup(q)


@router.get("/tools/convert/table")
def convert_table(act: Optional[str] = None, _: User = Depends(get_user)):
    """The whole table, for browsing. act: IPC, BNS, CRPC, BNSS, IEA or BSA."""
    return converter.browse(act.upper() if act else None)
