"""Opposing-side check: what could the other side say against our authorities and position?

Retrieval first, always: (1) later judgments in the library that overruled, doubted or distinguished any
authority saved to the matter, (2) paragraphs in the library that point the other way. With a language model
the paragraphs are also summarised into likely counter-arguments, with every claim tied to a numbered source;
markers that do not match a source are removed. Without one you get the retrieval alone.
"""
from __future__ import annotations

import re

from . import research

CONTRARY = re.compile(
    r"\b(not\s+maintainable|cannot\s+be\s+(?:said|held|accepted)|no\s+merit|rejected|distinguish(?:ed|able)|"
    r"does\s+not\s+apply|not\s+applicable|dismissed|liable\s+to\s+be\s+quashed|acquitted|failed\s+to\s+prove|"
    r"rebut(?:ted|s)?|presumption\s+(?:stands\s+)?rebutted|time[- ]barred|barred\s+by\s+limitation)\b", re.I)

SYSTEM = (
    "You help an Indian advocate prepare for the OTHER side's arguments. Use ONLY the numbered sources. "
    "List the strongest points the opposing side could make against the advocate's position, each ending with the "
    "marker(s) of the source(s) it relies on, like [S2]. If no source supports an opposing point, say so; never "
    "invent a case, section or paragraph. Reply with one JSON object: {\"answer\": string, \"limitations\": string}.")


def check(store, llm, *, position: str, saved: list[dict]) -> dict:
    """saved: [{jid,title,citation}] authorities already saved to the matter."""
    adverse = []
    for b in saved:
        try:
            ln = store.links(b["jid"])
        except Exception:
            continue
        bad = [c for c in ln["cited_by"] if c["treatment"] in ("negative", "caution")]
        if bad:
            adverse.append({"jid": b["jid"], "title": b["title"], "citation": b.get("citation", ""),
                            "worst": "negative" if any(c["treatment"] == "negative" for c in bad) else "caution",
                            "citing": [{"id": c["id"], "title": c["title"], "court": c["court"], "year": c["year"],
                                        "treatment": c["treatment"], "paras": c["paras"][:5]} for c in bad[:6]]})
    saved_ids = {b["jid"] for b in saved}
    pool = research.retrieve(store, position, k=16, per_judgment=2, llm=llm, rerank=False) if position.strip() else []
    contrary = [dict(s, why="reads against the position" if CONTRARY.search(s["text"]) else "")
                for s in pool if s["jid"] not in saved_ids]
    contrary.sort(key=lambda s: (not s["why"], s["sid"]))
    contrary = contrary[:8]
    for i, s in enumerate(contrary, 1):
        s["sid"] = i
        s["text"] = s["text"][:900]
    out = {"position": position, "adverse_treatment": adverse, "contrary_sources": contrary, "mode": "retrieval_only",
           "answer": None, "checks": None,
           "message": "No language model is configured, so there is no written summary. The list below is what the "
                      "library holds. Read each paragraph yourself."}
    if not contrary or llm is None or not llm.available:
        if not contrary:
            out["message"] = "Nothing else in the library matches this position." if position.strip() else \
                "Add the proposition you are relying on to search for contrary paragraphs."
        return out
    body = "\n\n".join(f"[S{s['sid']}] {s['title']} | {s['citation'] or 'no citation'} | {s['court']} | "
                       f"paragraph {s['para_no']}\n{s['text']}" for s in contrary)
    try:
        data = llm.json(SYSTEM, f"Advocate's position: {position}\n\nSources:\n{body}", max_tokens=1200)
        raw = str(data.get("answer") or "").strip()
        if not raw:
            raise ValueError("empty")
    except Exception as exc:
        out["message"] = f"The language model step failed ({type(exc).__name__}). Showing the retrieved paragraphs."
        return out
    chk = research.verify_answer(raw, len(contrary))
    out.update(mode="answer", answer=chk["answer"], message="", limitations=str(data.get("limitations") or ""),
               checks={"invalid_markers_removed": chk["invalid_markers_removed"],
                       "uncited_sentences": chk["uncited_sentences"], "cited_sources": chk["cited_sources"]})
    return out
