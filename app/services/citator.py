"""Citator: how later judgments treat an earlier one, and which citations are the same case.

Treatment is read from the words around each citation in the citing paragraph:
  negative  — overruled, not good law, per incuriam, no longer good law
  caution   — distinguished, doubted, referred to a larger bench, explained, confined to its facts
  positive  — followed, relied on, approved, affirmed, applied, reiterated
  cited     — anything else
It is a signal for the advocate to read the citing paragraph, never a conclusion on its own.

Parallel citations ("(2019) 5 SCC 418 : AIR 2019 SC 1234") are harvested from judgment text so a case cited
by one reporter resolves even when the library only knows it by another.
"""
from __future__ import annotations

import re

from .citations import PATTERNS, _normalize

NEG = re.compile(r"\b(overrul(?:ed|es|ing)|not\s+(?:a\s+)?good\s+law|no\s+longer\s+(?:good\s+)?law|per\s+incuriam|"
                 r"stands?\s+overruled|impliedly\s+overruled|abrogated)\b", re.I)
CAUTION = re.compile(r"\b(distinguish(?:ed|able|ing)|doubted|referred\s+to\s+a\s+larger\s+bench|"
                     r"reconsider(?:ation|ed)|confined\s+to\s+(?:its|the)\s+(?:own\s+)?facts|explained|"
                     r"not\s+applicable|inapplicable|clarified)\b", re.I)
POS = re.compile(r"\b(followed|following|relied\s+(?:up)?on|relying\s+(?:up)?on|approved|affirmed|applied|"
                 r"reiterated|endorsed|squarely\s+covered|binding)\b", re.I)
RANK = {"negative": 3, "caution": 2, "positive": 1, "cited": 0}
SEP = re.compile(r"^\s*(?:[:=;]|,\s*(?=\(|\[|AIR|\d{4}))\s*$")


def classify(window: str) -> str:
    if NEG.search(window):
        return "negative"
    if CAUTION.search(window):
        return "caution"
    if POS.search(window):
        return "positive"
    return "cited"


def _hits(text: str) -> list:
    hits = []
    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            hits.append((m.start(), m.end(), _normalize(kind, m.groups())))
    hits.sort(key=lambda h: (h[0], -h[1]))
    kept, last = [], -1
    for h in hits:
        if h[0] >= last:
            kept.append(h)
            last = h[1]
    return kept


def analyse(paragraphs: list) -> tuple:
    """Returns (refs, pairs). refs: [{norm, para_no, treatment}], pairs: [(norm_a, norm_b)] parallel citations."""
    refs, pairs, seen = [], set(), {}
    for p in paragraphs:
        text = p["text"]
        hits = _hits(text)
        for i, (a, b, norm) in enumerate(hits):
            window = text[max(0, a - 260): min(len(text), b + 260)]
            t = classify(window)
            key = (norm, p["no"])
            if key not in seen or RANK[t] > RANK[seen[key]["treatment"]]:
                seen[key] = {"norm": norm, "para_no": p["no"], "treatment": t}
            if i + 1 < len(hits) and SEP.match(text[b:hits[i + 1][0]]) and hits[i + 1][2] != norm:
                pairs.add(tuple(sorted((norm, hits[i + 1][2]))))
    refs = list(seen.values())
    return refs, sorted(pairs)


def worst(treatments) -> str:
    best = "cited"
    for t in treatments:
        if RANK.get(t, 0) > RANK[best]:
            best = t
    return best
