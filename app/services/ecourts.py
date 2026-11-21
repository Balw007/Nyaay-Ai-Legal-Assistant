"""eCourts case sync through the eCourtsIndia partner API (webapi.ecourtsindia.com, Bearer token).

GET  /api/partner/case/{cnr}          full case record (orders' text under files.files[].markdownContent)
POST /api/partner/case/{cnr}/refresh  queue a live re-scrape

The provider's response schema is not published field-by-field, so fields are found defensively by name
and the raw keys are kept in sync_status for diagnosis. Every change becomes a PROPOSED task — never applied
silently.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional

from ..config import ECOURTSINDIA_TOKEN

API = "https://webapi.ecourtsindia.com"
CNR_RE = re.compile(r"^[A-Z]{4}\d{12}$")
NEXT_KEYS = ("nexthearingdate", "nextdate", "next_hearing_date", "nextlistingdate", "next_date")
STATUS_KEYS = ("casestatus", "status", "stageofcase", "case_stage", "purpose", "purposeofhearing")


class EcourtsError(RuntimeError):
    pass


def available() -> bool:
    return bool(ECOURTSINDIA_TOKEN)


def valid_cnr(cnr: str) -> bool:
    return bool(CNR_RE.match((cnr or "").strip().upper()))


def _parse_date(v) -> Optional[date]:
    if not v or not isinstance(v, str):
        return None
    v = v.strip()
    for cand in (v, v[:10], v.split("T")[0]):
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d %B %Y", "%d %b %Y"):
            try:
                return datetime.strptime(cand, fmt).date()
            except ValueError:
                continue
    return None


def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield f"{path}.{k}" if path else k, k, v
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")


def parse_case(payload: dict) -> dict:
    nxt, status, orders = None, None, []
    for path, key, val in _walk(payload):
        k = key.lower().replace("_", "")
        if nxt is None and k in {x.replace("_", "") for x in NEXT_KEYS}:
            nxt = _parse_date(val) if isinstance(val, str) else None
        if status is None and k in {x.replace("_", "") for x in STATUS_KEYS} and isinstance(val, str) and val.strip():
            status = val.strip()[:120]
        if k == "markdowncontent" and isinstance(val, str) and len(val.strip()) > 40:
            orders.append(val.strip())
    return {"next_date": nxt, "status": status, "orders": orders,
            "keys": sorted({p.split("[")[0] for p, _, _ in _walk(payload)})[:60]}


def fetch_case(cnr: str, client=None, refresh: bool = False) -> dict:
    if not available():
        raise EcourtsError("eCourts sync is not configured. Set ECOURTSINDIA_TOKEN.")
    cnr = cnr.strip().upper()
    if not valid_cnr(cnr):
        raise EcourtsError("A CNR has 16 characters: 4 letters then 12 digits, e.g. MHPU010012342024.")
    import httpx

    c = client or httpx.Client(timeout=30)
    h = {"Authorization": f"Bearer {ECOURTSINDIA_TOKEN}", "Accept": "application/json"}
    if refresh:
        try:
            c.post(f"{API}/api/partner/case/{cnr}/refresh", headers=h)
        except Exception:
            pass
    r = c.get(f"{API}/api/partner/case/{cnr}", headers=h)
    if r.status_code == 404:
        raise EcourtsError("eCourts has no case with this CNR yet. Check the CNR or try again later.")
    if r.status_code in (401, 403):
        raise EcourtsError("The eCourts token was rejected. Check ECOURTSINDIA_TOKEN.")
    r.raise_for_status()
    return r.json()
