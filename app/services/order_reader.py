"""Read a court order: dates, directions, summary, stage, and a client message.

Two paths:
  - LLM (when available): better summaries, directions and client messages in Hindi/Marathi.
  - Rules: regex heuristics that always work offline.
The stage always comes from the playbook keywords; the next date is always cross-checked and flagged.
"""
from __future__ import annotations

import calendar
import re
from datetime import date

from . import playbook as pbk
from .llm import LLM

MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})
MONTHS["sept"] = 9

NUM = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
TXT_DMY = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})\b")
TXT_MDY = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b")

NEXT_DATE_CUES = [
    "next date", "adjourned to", "adjourned till", "adjourned for", "posted for", "posted to", "listed on",
    "listed for", "list on", "put up on", "put up for", "stand over to", "stands over to", "fixed for",
    "to come up on", "next hearing", "re-notify on", "call on",
]
ORDER_DATE_CUES = ["order dated", "dated", "date:", "date -", "date –"]
DIRECTION_RE = re.compile(
    r"\b(directed|directs|direct|ordered|is ordered|shall|issue|file|appear|produce|serve|"
    r"deposit|pay|furnish|submit|comply|notice to|to take steps|to file|to remain present)\b", re.I)
# Sentences that only record what already happened are not directions ("Evidence affidavit filed.")
PAST_ONLY_RE = re.compile(r"\b(filed|was issued|has been issued|recorded|closed|present|absent|returned)\b\.?$", re.I)


def find_dates(text: str) -> list[tuple[date, int, int]]:
    """All dates in the text as (date, start, end). Indian day-first order for numeric dates."""
    found: list[tuple[date, int, int]] = []
    for m in NUM.finditer(text):
        try:
            found.append((date(int(m.group(3)), int(m.group(2)), int(m.group(1))), m.start(), m.end()))
        except ValueError:
            pass
    for m in TXT_DMY.finditer(text):
        mon = MONTHS.get(m.group(2).lower())
        if mon:
            try:
                found.append((date(int(m.group(3)), mon, int(m.group(1))), m.start(), m.end()))
            except ValueError:
                pass
    for m in TXT_MDY.finditer(text):
        mon = MONTHS.get(m.group(1).lower())
        if mon:
            try:
                found.append((date(int(m.group(3)), mon, int(m.group(2))), m.start(), m.end()))
            except ValueError:
                pass
    return sorted(found, key=lambda x: x[1])


def find_order_date(text: str) -> date | None:
    dates = find_dates(text)
    head = text[:700].lower()
    for cue in ORDER_DATE_CUES:
        pos = head.find(cue)
        if pos != -1:
            for d, s, _ in dates:
                if s >= pos and s - pos < 60:
                    return d
    return dates[0][0] if dates else None


def find_next_date(text: str, order_date: date | None) -> date | None:
    dates = find_dates(text)
    low = text.lower()
    candidates: list[tuple[int, date]] = []
    for cue in NEXT_DATE_CUES:
        for m in re.finditer(re.escape(cue), low):
            for d, s, _ in dates:
                if m.end() <= s <= m.end() + 100:
                    candidates.append((s, d))
                    break
    if not candidates:
        return None
    candidates.sort()
    # Prefer the last cue-linked date; hearings are listed at the end of an order.
    return candidates[-1][1]


def _sentences(text: str) -> list[str]:
    flat = re.sub(r"\s+", " ", text.replace(" v. ", " v~ "))
    parts = re.split(r"(?<=[.;!?])\s+", flat)
    return [p.replace(" v~ ", " v. ").strip() for p in parts if len(p.strip()) > 15]


def rule_extract(text: str) -> dict:
    sents = _sentences(text)
    directions = [s for s in sents if DIRECTION_RE.search(s) and not PAST_ONLY_RE.search(s.strip())][:8]
    summary = " ".join(sents[:3])[:500]
    return {"summary": summary, "directions": directions}


def client_message_template(client_name: str | None, matter_title: str, order_date: date | None,
                            next_date: date | None, language: str) -> tuple[str, list[str]]:
    review: list[str] = []
    if language != "en":
        review.append("Hindi/Marathi client messages need the LLM; an English message was drafted instead.")
    hello = f"Dear {client_name}," if client_name else "Dear client,"
    heard = f"the court passed an order on {order_date:%d %b %Y}" if order_date else "the court passed an order"
    nxt = (f"The next hearing is on {next_date:%d %b %Y}." if next_date
           else "We will confirm the next hearing date once we have checked the order.")
    return (f"{hello}\n\nIn your matter ({matter_title}), {heard}. {nxt}\n"
            f"We will update you on any action needed from your side.\n"), review


def read_order(text: str, pb: dict, llm: LLM, *, matter_title: str = "", client_name: str | None = None,
               language: str = "en") -> dict:
    """Main entry point. Returns a dict ready to store on an Order row."""
    review: list[str] = []
    order_date = find_order_date(text)
    next_date = find_next_date(text, order_date)
    base = rule_extract(text)
    summary, directions, message, method = base["summary"], base["directions"], "", "rules"

    if llm.available:
        try:
            lang_name = {"en": "English", "hi": "Hindi", "mr": "Marathi"}.get(language, "English")
            data = llm.json(
                "You read Indian court orders for advocates. Use only the text given. "
                "Reply with one JSON object: {\"summary\": str (max 80 words), \"directions\": [str], "
                f"\"client_message\": str (polite, plain, in {lang_name}, no legal advice)}}. "
                "Do not invent dates, names or section numbers.",
                text[:12000])
            summary = str(data.get("summary") or summary)[:800]
            directions = [str(x) for x in (data.get("directions") or directions)][:8]
            message = str(data.get("client_message") or "")
            method = "llm+rules"
        except Exception as exc:  # network, parsing, quota: fall back, but say so
            review.append(f"LLM step failed ({type(exc).__name__}); rule-based reading used.")

    if not message:
        message, extra = client_message_template(client_name, matter_title, order_date, next_date, language)
        review += extra

    stage, conf, matched = pbk.detect_stage(pb, text)

    if len(text.strip()) < 200:
        review.append("Very little text was read; the scan may be poor. Check the order manually.")
    if next_date is None:
        review.append("Next date not found. Read the order and enter it manually.")
    elif order_date and next_date < order_date:
        review.append("Next date is before the order date; check for a reading error.")
    if stage is None:
        review.append("Stage not detected from the order text.")
    elif conf < 0.6:
        review.append(f"Stage guess '{stage}' has low confidence.")

    return {
        "order_date": order_date, "next_date": next_date, "summary": summary, "directions": directions,
        "detected_stage": stage, "stage_confidence": conf, "matched_keywords": matched,
        "extraction_method": method, "needs_review": review, "client_message": message,
    }
