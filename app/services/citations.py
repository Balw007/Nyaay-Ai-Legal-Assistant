"""Citation checker.

Pipeline: extract citations from a draft -> resolve each to a judgment in the index -> locate the
closest paragraphs to the proposition the draft attaches to it -> test whether they support it.

Trust rules baked in:
  * Only VERIFIED passes the export gate (or an advocate's explicit confirmation).
  * Without an LLM nothing is ever VERIFIED automatically: at best EXISTS_UNCHECKED.
  * A citation we cannot find is NOT_FOUND. We never guess a close match.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from ..config import JUDGMENT_INDEX
from .llm import LLM

VERIFIED = "VERIFIED"
EXISTS_NOT_SUPPORTED = "EXISTS_NOT_SUPPORTED"
EXISTS_UNCHECKED = "EXISTS_UNCHECKED"
CITATION_MISMATCH = "CITATION_MISMATCH"
NOT_FOUND = "NOT_IN_LIBRARY"  # not in this library; says nothing about whether the case exists
FOUND_EXTERNALLY = "FOUND_EXTERNALLY"

PATTERNS = [
    ("INSC", re.compile(r"\b((?:19|20)\d{2})\s+INSC\s+(\d+)\b")),
    ("SCC_ONLINE", re.compile(r"\b((?:19|20)\d{2})\s+SCC\s+OnLine\s+([A-Za-z]+)\s+(\d+)\b", re.I)),
    ("SCC", re.compile(r"\(((?:19|20)\d{2})\)\s*(\d+)\s+SCC\s+(\d+)\b")),
    ("SCR", re.compile(r"\[((?:19|20)\d{2})\]\s*(\d+)\s+S\.?\s?C\.?\s?R\.?\s+(\d+)\b")),
    ("AIR", re.compile(r"\bAIR\s+((?:19|20)\d{2})\s+([A-Za-z]+)\s+(\d+)\b")),
    ("SCC_CRI", re.compile(r"\(((?:19|20)\d{2})\)\s*(\d+)\s+SCC\s*\((Cri|Civ|L\s?&\s?S|Tax)\)\s*(\d+)\b", re.I)),
    ("SCALE", re.compile(r"\(((?:19|20)\d{2})\)\s*(\d+)\s+SCALE\s+(\d+)\b", re.I)),
    ("MANU", re.compile(r"\bMANU/([A-Z]{2,4})/(\d{3,5})/((?:19|20)\d{2})\b")),
    ("CRILJ", re.compile(r"\b((?:19|20)\d{2})\s+Cri\.?\s?L\.?\s?J\.?\s+(\d+)\b", re.I)),
    ("HC_NEUTRAL", re.compile(r"\b((?:19|20)\d{2}):([A-Z]{2,6}(?:-[A-Z]{2,4})?):(\d{1,6})(?:-DB)?\b")),
]

STOP = set("the a an of and or to in on for by with as at is are was were be been this that it its from "
           "not no which has have had under shall may can where such any who whom held".split())
NAME_STOP = {"v", "vs", "versus", "ltd", "limited", "the", "and", "of", "in", "by", "as", "held", "see", "per"}


def _normalize(kind: str, g: tuple[str, ...]) -> str:
    if kind == "INSC":
        return f"{g[0]} INSC {g[1]}"
    if kind == "SCC_ONLINE":
        return f"{g[0]} SCC OnLine {g[1].upper()} {g[2]}"
    if kind == "SCC":
        return f"({g[0]}) {g[1]} SCC {g[2]}"
    if kind == "SCR":
        return f"[{g[0]}] {g[1]} SCR {g[2]}"
    if kind == "SCC_CRI":
        series = re.sub(r"\s", "", g[2]).title()
        return f"({g[0]}) {g[1]} SCC ({series}) {g[3]}"
    if kind == "SCALE":
        return f"({g[0]}) {g[1]} SCALE {g[2]}"
    if kind == "MANU":
        return f"MANU/{g[0]}/{g[1]}/{g[2]}"
    if kind == "CRILJ":
        return f"{g[0]} CriLJ {g[1]}"
    if kind == "HC_NEUTRAL":
        return f"{g[0]}:{g[1]}:{g[2]}"
    return f"AIR {g[0]} {g[1].upper()} {g[2]}"


def extract_norms(text: str) -> set:
    """Every citation in the text as its normalized string (fast; used to build the cites graph)."""
    out = set()
    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            out.add(_normalize(kind, m.groups()))
    return out


def normalize_any(raw: str) -> str:
    for kind, pat in PATTERNS:
        m = pat.search(raw)
        if m:
            return _normalize(kind, m.groups())
    return re.sub(r"\s+", " ", raw.strip()).upper()


@dataclass
class Citation:
    raw: str
    kind: str
    normalized: str
    start: int
    end: int
    case_name: str | None
    proposition: str


def _sentence_spans(text: str) -> list[tuple[int, int]]:
    protected = text.replace(" v. ", " v~ ").replace(" vs. ", " vs~ ")  # same length, hides the full stop
    spans, prev = [], 0
    for m in re.finditer(r"(?<=[.!?])\s+(?=[A-Z(\[])", protected):
        spans.append((prev, m.start()))
        prev = m.end()
    spans.append((prev, len(text)))
    return spans


def _case_name(text: str, start: int, prev_end: int) -> str | None:
    window_start = max(prev_end, start - 160)
    window = text[window_start:start]
    if ";" in window:
        window = window.rsplit(";", 1)[1]
    last = None
    for last in re.finditer(r"\bv(?:s)?\.?\s", window):
        pass
    if last is None:
        return None
    left = " ".join(window[:last.start()].split()[-6:])
    right = " ".join(re.split(r"[,(\[\d]", window[last.end():])[0].split()[:6])
    if not left or not right:
        return None
    return f"{left} v. {right}"


def find_citations(text: str) -> list[Citation]:
    raw_hits: list[tuple[int, int, str, str, str]] = []
    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            raw_hits.append((m.start(), m.end(), kind, m.group(0), _normalize(kind, m.groups())))
    raw_hits.sort(key=lambda h: (h[0], -h[1]))  # longest match first at the same position
    kept, last_end = [], -1
    for h in raw_hits:  # drop overlapping matches
        if h[0] >= last_end:
            kept.append(h)
            last_end = h[1]

    spans = _sentence_spans(text)
    out: list[Citation] = []
    prev_end = 0
    for start, end, kind, raw, norm in kept:
        sentence = next((text[a:b] for a, b in spans if a <= start <= b), text[max(0, start - 200):end + 100])
        prop = re.sub(r"\s+", " ", sentence.replace(raw, " ")).strip()
        out.append(Citation(raw, kind, norm, start, end, _case_name(text, start, prev_end), prop))
        prev_end = end
    return out


# ---------------------------------------------------------------- index

@dataclass
class Judgment:
    id: str
    title: str
    court: str
    date: str
    citations: list[str]
    paragraphs: list[dict]
    source: str = ""


def _tokens(s: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", s.lower()) if len(t) > 2 and t not in STOP]


def _name_tokens(s: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in NAME_STOP}


def name_match(draft_name: str, title: str) -> float:
    """Share of the index title's words found in the draft's case name."""
    a, b = _name_tokens(draft_name), _name_tokens(title)
    return len(a & b) / len(b) if b else 0.0


def bm25_rank(paras: list[dict], query: str, k1: float = 1.5, b: float = 0.75) -> list[tuple[dict, float, float]]:
    docs = [_tokens(p["text"]) for p in paras]
    n = len(docs)
    avg = (sum(len(d) for d in docs) / n) if n else 1.0
    df: Counter = Counter()
    for d in docs:
        df.update(set(d))
    q = set(_tokens(query))
    ranked = []
    for p, d in zip(paras, docs):
        tf = Counter(d)
        score = 0.0
        for t in q & set(tf):
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            score += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / (avg or 1)))
        overlap = len(q & set(d)) / len(q) if q else 0.0
        ranked.append((p, score, overlap))
    return sorted(ranked, key=lambda x: (-x[1], -x[2]))


class JudgmentIndex:
    def __init__(self, judgments: list[Judgment]):
        self.judgments = judgments
        self.by_cite: dict[str, Judgment] = {}
        for j in judgments:
            for c in j.citations:
                self.by_cite[normalize_any(c)] = j

    @classmethod
    def from_file(cls, path: str | Path) -> "JudgmentIndex":
        p = Path(path)
        if not p.exists():
            return cls([])
        data = json.loads(p.read_text(encoding="utf-8"))
        return cls([Judgment(**{k: v for k, v in j.items() if k in Judgment.__dataclass_fields__})
                    for j in data["judgments"]])

    def resolve(self, cit: Citation) -> tuple[Judgment | None, str]:
        j = self.by_cite.get(cit.normalized)
        if j:
            return j, "citation"
        if cit.case_name:
            best = max(self.judgments, key=lambda x: name_match(cit.case_name, x.title), default=None)
            if best and name_match(cit.case_name, best.title) >= 0.7:
                return best, "name_only"
        return None, "none"


_index = None


def get_index():
    """The checker reads from the judgment store (real corpus once ingested)."""
    global _index
    if _index is None:
        from .store import StoreIndex, get_store  # imported here: store imports this module

        _index = StoreIndex(get_store())
    return _index


def set_index(index) -> None:
    global _index
    _index = index


# ---------------------------------------------------------------- checking

SUPPORT_SYSTEM = (
    "You verify whether judgment paragraphs support a legal proposition stated in a lawyer's draft. "
    "Use ONLY the paragraphs provided, no outside knowledge. Reply with one JSON object: "
    "{\"verdict\": \"supports\" | \"partly\" | \"does_not_support\", \"reason\": \"one sentence\"}. "
    "If the paragraphs do not address the proposition, answer does_not_support."
)


def judge_support(llm: LLM, proposition: str, paras: list[dict]) -> dict:
    if not llm.available:
        return {"verdict": "unchecked", "method": "none",
                "reason": "No language model configured, so support was not checked."}
    body = "\n".join(f"[para {p['no']}] {p['text']}" for p in paras)
    try:
        data = llm.json(SUPPORT_SYSTEM, f"Proposition in the draft:\n{proposition}\n\nJudgment paragraphs:\n{body}")
        verdict = data.get("verdict")
        if verdict not in {"supports", "partly", "does_not_support"}:
            raise ValueError("bad verdict")
        return {"verdict": verdict, "method": "llm", "reason": str(data.get("reason", ""))[:300]}
    except Exception as exc:
        return {"verdict": "unchecked", "method": "none", "reason": f"Support check failed ({type(exc).__name__})."}


def check_text(text: str, index: JudgmentIndex, llm: LLM, on_item=None) -> list[dict]:
    """on_item(i, total, raw) is called before each citation is checked (progress reporting only)."""
    items: list[dict] = []
    found = find_citations(text)
    for i, cit in enumerate(found):
        if on_item is not None:
            on_item(i, len(found), cit.raw)
        item = {
            "index": i, "citation": cit.raw, "normalized": cit.normalized, "kind": cit.kind,
            "case_name": cit.case_name, "proposition": cit.proposition, "status": NOT_FOUND,
            "judgment_id": None, "judgment_title": None, "court": None, "paragraphs": [],
            "overlap": 0.0, "support": {"verdict": "unchecked", "method": "none", "reason": ""},
            "message": "", "advocate_confirmed": False,
        }
        from . import indiankanoon as ik

        item["search_url"] = ik.public_search_url(cit.raw)
        j, how = index.resolve(cit)
        if j is None:
            ext = None
            try:
                ext = ik.lookup(cit.raw, cit.case_name)
            except Exception:
                ext = None
            if ext:
                item.update(status=FOUND_EXTERNALLY, external=ext, judgment_title=ext["title"])
                if cit.case_name and name_match(cit.case_name, ext["title"]) < 0.5:
                    item["status"] = CITATION_MISMATCH
                    item["message"] = (f"Indian Kanoon returns '{ext['title']}' for this citation, but the draft names "
                                       f"'{cit.case_name}'. Check which case is meant.")
                else:
                    item["message"] = "Found on Indian Kanoon (not in your library). Open it and read the paragraph."
            else:
                item["message"] = ("Not in your Nyaay library. This does not mean the citation is wrong: most SCC and "
                                   "AIR reports are not in open data. Check it on Indian Kanoon, SCC Online or Manupatra.")
            items.append(item)
            continue

        item.update(judgment_id=j.id, judgment_title=j.title, court=j.court)
        if how == "name_only":
            item["status"] = CITATION_MISMATCH
            item["message"] = f"A case named '{j.title}' exists, but not under this citation. Check the citation."
            items.append(item)
            continue
        if cit.case_name and name_match(cit.case_name, j.title) < 0.5:
            item["status"] = CITATION_MISMATCH
            item["message"] = (f"This citation belongs to '{j.title}', but the draft names "
                               f"'{cit.case_name}'. Check which case is meant.")
            items.append(item)
            continue

        ranked = bm25_rank(j.paragraphs, cit.proposition)[:2]
        item["paragraphs"] = [{"no": p["no"], "text": p["text"], "score": round(s, 2)} for p, s, _ in ranked]
        item["overlap"] = round(ranked[0][2], 2) if ranked else 0.0
        support = judge_support(llm, cit.proposition, [p for p, _, _ in ranked])
        item["support"] = support
        if support["verdict"] == "supports":
            item["status"], item["message"] = VERIFIED, "Judgment found and the paragraph supports the point."
        elif support["verdict"] == "does_not_support":
            item["status"] = EXISTS_NOT_SUPPORTED
            item["message"] = "Judgment exists but the closest paragraphs do not support this point."
        elif support["verdict"] == "partly":
            item["status"] = EXISTS_UNCHECKED
            item["message"] = "Judgment exists and partly supports the point. Read the paragraph before relying on it."
        else:
            item["status"] = EXISTS_UNCHECKED
            item["message"] = "Judgment exists. Whether it supports the point has not been checked; read the paragraph."
        items.append(item)
    return items


def summarize(items: list[dict]) -> dict:
    counts = Counter(i["status"] for i in items)
    blockers = [i for i in items if i["status"] != VERIFIED and not i.get("advocate_confirmed")]
    return {
        "total": len(items),
        "counts": dict(counts),
        "can_export": not blockers,
        "blockers": [{"index": b["index"], "citation": b["citation"], "status": b["status"]} for b in blockers],
        "note": "No citations found in the text." if not items else "",
    }
