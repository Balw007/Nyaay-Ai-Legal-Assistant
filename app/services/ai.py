"""Per-firm AI gateway. Every AI call in the product goes through here, so that:
  * a firm that switched AI off never has data sent to a provider
  * identifiers (Aadhaar, PAN, phone, email, IFSC, account numbers) are redacted and restored
  * each call is metered (tokens, feature, model) and stopped when the monthly budget is used up
  * the strong model is used only where quality matters; routine work uses the fast model
"""
from __future__ import annotations

from datetime import datetime, timezone
import inspect
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import DEFAULT_MONTHLY_TOKEN_BUDGET, MODEL, MODEL_FAST
from ..models import Firm, UsageLog
from .llm import LLM, NullLLM, get_llm
from .security import redact, restore

STRONG = {"answer", "polish"}  # everything else uses the fast model

DEFAULT_SETTINGS = {"ai_enabled": True, "redact_pii": True, "monthly_token_budget": DEFAULT_MONTHLY_TOKEN_BUDGET,
                    "rerank": True, "closed_saturdays": "second_fourth", "require_review": True}


SECRET_SETTINGS = {"telegram_bot_token"}  # stored in Firm.settings but never returned to the browser


class BudgetExceeded(RuntimeError):
    pass


def firm_settings(firm: Optional[Firm]) -> dict:
    s = dict(DEFAULT_SETTINGS)
    s.update({k: v for k, v in ((firm.settings or {}) if firm else {}).items() if k not in SECRET_SETTINGS})
    return s


def month_usage(db: Session, firm_id: int) -> int:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    r = db.query(func.coalesce(func.sum(UsageLog.input_tokens + UsageLog.output_tokens), 0)).filter(
        UsageLog.firm_id == firm_id, UsageLog.created_at >= start).scalar()
    return int(r or 0)


class FirmLLM(LLM):
    def __init__(self, base: LLM, db: Session, firm_id: int, feature: str, user_id: Optional[int] = None):
        self.base, self.db, self.firm_id, self.feature, self.user_id = base, db, firm_id, feature, user_id
        firm = db.get(Firm, firm_id)
        self.settings = firm_settings(firm)
        self.available = bool(base.available and self.settings["ai_enabled"])
        self.name = base.name if self.available else "none"
        self.model = (MODEL if feature in STRONG else MODEL_FAST) if self.available else None

    def _check_budget(self):
        if month_usage(self.db, self.firm_id) >= int(self.settings["monthly_token_budget"]):
            raise BudgetExceeded("This firm's monthly AI allowance is used up. An admin can raise it in Settings.")

    def _log(self, ok: bool):
        i, o = getattr(self.base, "last_usage", (0, 0)) if ok else (0, 0)
        self.db.add(UsageLog(firm_id=self.firm_id, user_id=self.user_id, feature=self.feature,
                             model=self.model or "", input_tokens=i, output_tokens=o, ok=ok))
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()

    def for_feature(self, feature: str) -> "FirmLLM":
        return FirmLLM(self.base, self.db, self.firm_id, feature, self.user_id)

    def json(self, system: str, user: str, max_tokens: int = 1500, model: str = None) -> dict:
        if not self.available:
            raise RuntimeError("AI is switched off for this firm")
        self._check_budget()
        mapping = {}
        if self.settings["redact_pii"]:
            user, mapping = redact(user)
        try:
            kw = {"max_tokens": max_tokens}
            if "model" in inspect.signature(self.base.json).parameters:
                kw["model"] = model or self.model
            out = self.base.json(system, user, **kw)
        except Exception:
            self._log(False)
            raise
        self._log(True)
        return restore(out, mapping)

    def transcribe(self, data: bytes, media_type: str, model: str = None) -> str:
        if not self.available:
            raise RuntimeError("AI is switched off for this firm")
        self._check_budget()
        try:
            out = self.base.transcribe(data, media_type, model=model or MODEL_FAST)
        except Exception:
            self._log(False)
            raise
        self._log(True)
        return out


def firm_llm(db: Session, firm_id: int, feature: str, user_id: Optional[int] = None) -> LLM:
    base = get_llm()
    if not base.available:
        return NullLLM()
    return FirmLLM(base, db, firm_id, feature, user_id)
