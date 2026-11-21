"""Optional external check against Indian Kanoon's paid API (api.indiankanoon.org, 'Authorization: Token ...').

Used when a citation is not in the firm's own library, so a correct SCC/AIR citation is not reported as missing.
Only the citation and case name are sent — never the draft.
"""
from __future__ import annotations

import re
from typing import Optional
from urllib.parse import quote

from ..config import INDIANKANOON_TOKEN

API = "https://api.indiankanoon.org"


def public_search_url(q: str) -> str:
    return f"https://indiankanoon.org/search/?formInput={quote(q)}"


def available() -> bool:
    return bool(INDIANKANOON_TOKEN)


def _post(path: str, params: dict, client=None) -> dict:
    import httpx

    c = client or httpx.Client(timeout=20)
    r = c.post(f"{API}{path}", params=params, headers={"Authorization": f"Token {INDIANKANOON_TOKEN}",
                                                         "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def _strip(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html or "")).strip()


def lookup(citation: str, case_name: Optional[str] = None, client=None) -> Optional[dict]:
    """Return {tid, title, url, docsource} for the best match, or None."""
    if not available():
        return None
    q = f'"{citation}"' + (f' "{case_name}"' if case_name else "")
    data = _post("/search/", {"formInput": q, "pagenum": 0}, client)
    docs = data.get("docs") or []
    if not docs and case_name:
        data = _post("/search/", {"formInput": f'"{citation}"', "pagenum": 0}, client)
        docs = data.get("docs") or []
    if not docs:
        return None
    d = docs[0]
    return {"tid": d.get("tid"), "title": _strip(d.get("title", "")), "docsource": d.get("docsource", ""),
            "url": f"https://indiankanoon.org/doc/{d.get('tid')}/", "headline": _strip(d.get("headline", ""))[:400]}
