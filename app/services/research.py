"""AI research assistant: retrieve paragraphs, answer only from them, then verify the answer's own citations.

The model never sees the open web or its memory as a source. It gets numbered paragraphs from the corpus and
must mark every proposition with [S#]. After the model answers we check the markers ourselves:
  * markers that do not match a retrieved source are removed and flagged
  * sentences that state something but carry no marker are flagged as uncited
Without a language model the same retrieval is returned as plain search results.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from typing import Optional

from .llm import LLM
from .store import Store, _first_cite

SYSTEM = (
    "You are a research assistant for Indian advocates. Answer ONLY from the numbered sources provided. "
    "End every sentence that states a legal proposition with the marker(s) of the source(s) it relies on, "
    "like [S2] or [S1][S3]. If the sources do not answer the question, say so plainly and do not guess. "
    "Never name a case, section or paragraph that is not in the sources. If a source carries a WARNING about "
    "later treatment, say so where you rely on it. Be concise and precise. "
    "Reply with one JSON object: {\"answer\": string, \"confidence\": \"high\"|\"medium\"|\"low\", "
    "\"limitations\": string}."
)

MARK = re.compile(r"\[S(\d+)\]")


RERANK_SYSTEM = (
    "You rank judgment paragraphs by how directly they answer a lawyer's question. Use only the text given. "
    "Reply with one JSON object: {\"order\": [paragraph numbers, most relevant first]}. Leave out irrelevant ones."
)


def retrieve(store: Store, question: str, *, jid: Optional[str] = None, court: Optional[str] = None,
             year_from=None, year_to=None, k: int = 10, per_judgment: int = 3, llm: Optional[LLM] = None,
             rerank: bool = True) -> list:
    rows, _ = store.hybrid(question, court=court, year_from=year_from, year_to=year_to, jid=jid, limit=80)
    out, counts = [], Counter()
    pool = 24 if (llm is not None and llm.available and rerank and not jid) else k
    for r in rows:
        if counts[r["jid"]] >= per_judgment:
            continue
        counts[r["jid"]] += 1
        out.append({"sid": len(out) + 1, "jid": r["jid"], "title": r["title"], "court": r["court"],
                    "decision_date": r["decision_date"], "citation": _first_cite(r["citations"]),
                    "para_no": r["no"], "text": r["text"]})
        if len(out) >= pool:
            break
    if len(out) > k and pool > k:
        try:
            body = "\n\n".join(f"[{i}] {s['text'][:700]}" for i, s in enumerate(out, 1))
            order = llm.for_feature("rerank").json(RERANK_SYSTEM, f"Question: {question}\n\n{body}", max_tokens=300) \
                if hasattr(llm, "for_feature") else llm.json(RERANK_SYSTEM, f"Question: {question}\n\n{body}", max_tokens=300)
            picked = [int(i) for i in order.get("order", []) if str(i).isdigit() and 1 <= int(i) <= len(out)]
            picked = list(dict.fromkeys(picked))
            if picked:
                out = [out[i - 1] for i in picked] + [s for i, s in enumerate(out, 1) if i not in picked]
        except Exception:
            pass  # keep fused ranking
    out = out[:k]
    for i, s in enumerate(out, 1):
        s["sid"] = i
    tr = store.treatment_summary([s["jid"] for s in out])
    for s in out:
        t = tr.get(s["jid"], {})
        s["treatment"] = "negative" if t.get("negative") else "caution" if t.get("caution") else \
            "positive" if t.get("positive") else "cited" if t.get("cited") else "none"
    return out


def verify_answer(answer: str, n_sources: int) -> dict:
    """Programmatic check of the model's own markers. Returns the cleaned answer and what we found wrong."""
    bad = sorted({int(m) for m in MARK.findall(answer) if not 1 <= int(m) <= n_sources})
    cleaned = answer
    for b in bad:
        cleaned = cleaned.replace(f"[S{b}]", "")
    sentences = re.split(r"(?<=[.!?])\s+", cleaned.strip())
    uncited = [s for s in sentences if len(s) > 60 and not MARK.search(s)]
    used = sorted({int(m) for m in MARK.findall(cleaned)})
    return {"answer": cleaned.strip(), "invalid_markers_removed": bad, "uncited_sentences": uncited,
            "cited_sources": used}


def ask(store: Store, llm: LLM, question: str, *, jid=None, court=None, year_from=None, year_to=None) -> dict:
    rerank = getattr(llm, "settings", {}).get("rerank", True)
    sources = retrieve(store, question, jid=jid, court=court, year_from=year_from, year_to=year_to, llm=llm,
                       rerank=rerank)
    base = {"question": question, "sources": sources}
    if not sources:
        return {**base, "mode": "no_sources", "answer": None,
                "message": "Nothing in the judgment database matches this question. Try different words, or "
                           "check that judgments have been loaded (python -m app.ingest sc --years 2024)."}
    if not llm.available:
        return {**base, "mode": "retrieval_only", "answer": None,
                "message": "No language model is configured, so no written answer. These are the most relevant "
                           "paragraphs. Start Ollama to get a written, cited answer."}
    warn = {"negative": " | WARNING: later judgments may have overruled or disapproved this case",
            "caution": " | NOTE: later judgments have distinguished or doubted this case"}
    body = "\n\n".join(
        f"[S{s['sid']}] {s['title']} | {s['citation'] or 'no citation'} | {s['court']} | "
        f"{s['decision_date']} | paragraph {s['para_no']}{warn.get(s.get('treatment'), '')}\n{s['text'][:1400]}"
        for s in sources)
    try:
        data = llm.json(SYSTEM, f"Question: {question}\n\nSources:\n{body}", max_tokens=1500)
        raw = str(data.get("answer") or "").strip()
        if not raw:
            raise ValueError("empty answer")
    except Exception as exc:
        return {**base, "mode": "retrieval_only", "answer": None,
                "message": f"The language model step failed ({type(exc).__name__}). Showing the retrieved paragraphs."}
    check = verify_answer(raw, len(sources))
    conf = data.get("confidence") if data.get("confidence") in {"high", "medium", "low"} else "low"
    if check["invalid_markers_removed"] or not check["cited_sources"]:
        conf = "low"
    return {**base, "mode": "answer", "answer": check["answer"], "confidence": conf,
            "limitations": str(data.get("limitations") or ""), "checks": {
                "invalid_markers_removed": check["invalid_markers_removed"],
                "uncited_sentences": check["uncited_sentences"], "cited_sources": check["cited_sources"]}}


SUMMARY_SYSTEM = (
    "You write a headnote-style summary of an Indian court judgment for an advocate, using ONLY the paragraphs "
    "given. Refer to paragraphs only by the numbers shown. Reply with one JSON object: {\"issues\": [string], "
    "\"held\": string, \"disposition\": string, \"key_paragraphs\": [integer]}. If the excerpt is not enough to "
    "say, write that in the field instead of guessing."
)


def summarize(store: Store, llm: LLM, jid: str) -> dict:
    j = store.get_judgment(jid)
    if not j:
        return {"mode": "not_found"}
    if j.get("summary"):
        return {"mode": "cached", **json.loads(j["summary"])}
    if not llm.available:
        return {"mode": "none", "message": "Start Ollama to generate summaries."}
    paras = j["paragraphs"]
    picked = paras[:8] + paras[-5:] if len(paras) > 13 else paras
    body = "\n\n".join(f"[para {p['no']}] {p['text'][:900]}" for p in picked)
    try:
        data = llm.json(SUMMARY_SYSTEM, f"{j['title']} ({j['court']}, {j['decision_date']})\n\n{body}",
                        max_tokens=900)
    except Exception as exc:
        return {"mode": "failed", "message": f"Summary failed ({type(exc).__name__})."}
    valid = {p["no"] for p in paras}
    out = {"issues": [str(x) for x in data.get("issues", [])][:6], "held": str(data.get("held", "")),
           "disposition": str(data.get("disposition", "")),
           "key_paragraphs": [n for n in data.get("key_paragraphs", []) if n in valid][:10],
           "basis": "Generated from the opening and closing paragraphs only. Read the judgment before relying on it."}
    store.set_summary(jid, json.dumps(out))
    return {"mode": "generated", **out}
