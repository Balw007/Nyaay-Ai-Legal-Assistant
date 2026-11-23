"""Data quality of the judgment library: a score for every judgment, the reasons, and the tools to fix what is fixable.

Every judgment is scored 0-100 from checks a person can understand. The score says "how far can I trust this record
as stored", not "how good is the judgment". A judgment under 70 should be looked at before it is relied on.

  python -m app.services.quality run        # score everything and print the summary
  python -m app.services.quality export out.csv
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from contextlib import closing
from datetime import date, datetime
from typing import Optional

# issue code -> (points taken off, what it means in plain words, how to fix)
CHECKS = {
    "missing_date": (15, "No decision date", "Edit the record and enter the date from the judgment."),
    "bad_date": (15, "The decision date is not a real date", "Edit the record and correct the date."),
    "year_mismatch": (10, "The year does not match the decision date", "Edit the date; the year follows it."),
    "missing_citation": (10, "No citation recorded", "Add the SCC / AIR / INSC citation if you have it."),
    "no_court": (10, "Court not recorded", "Choose the court."),
    "fallback_title": (10, "The title is not a case name", "Edit the title to the parties' names."),
    "short": (20, "Fewer than five paragraphs", "Open the source: the text may be cut off. Re-load it."),
    "low_text": (20, "Very little text", "Probably a scanned page or a stub. Re-run OCR or remove it."),
    "garbled": (35, "The text looks garbled (OCR or encoding damage)", "Re-run OCR on the original PDF."),
    "para_gaps": (5, "Paragraph numbers have gaps", "Text may be missing between paragraphs; check the source."),
}
ORDER = list(CHECKS)
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TITLE_OK = re.compile(r"\b(?:v\.?|vs\.?|versus)\b|^in re\b|^in the matter of\b|^re:", re.I)


def _valid_date(s: str) -> Optional[date]:
    if not _ISO.match(s or ""):
        return None
    try:
        d = datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None
    return d if date(1900, 1, 1) <= d <= date.today() else None


def garbled_share(text: str) -> float:
    """Share of characters that are not letters, digits, spaces or ordinary punctuation, plus replacement characters."""
    if not text:
        return 0.0
    ok_punct = ".,;:!?'\"()[]{}-\u2013\u2014/&%\u2018\u2019\u201c\u201d\u00a0\u00a7_*"
    # letters, digits and combining marks (Devanagari vowel signs are marks, not letters) are all normal text
    odd = sum(1 for ch in text if not (unicodedata.category(ch)[0] in "LNMZ" or ch.isspace() or ch in ok_punct))
    return odd / len(text)


def check_judgment(j: dict, paras: list) -> tuple:
    """j: judgments row (dict); paras: [{'no', 'text'}]. Returns (score, [issue codes])."""
    issues = []
    d = _valid_date(j.get("decision_date") or "")
    if not (j.get("decision_date") or "").strip():
        issues.append("missing_date")
    elif d is None:
        issues.append("bad_date")
    elif j.get("year") and int(j["year"]) != d.year:
        issues.append("year_mismatch")
    cits = json.loads(j.get("citations") or "[]") if isinstance(j.get("citations"), str) else (j.get("citations") or [])
    if not cits:
        issues.append("missing_citation")
    if not (j.get("court") or "").strip():
        issues.append("no_court")
    if not _TITLE_OK.search(j.get("title") or ""):
        issues.append("fallback_title")
    n = len(paras)
    chars = sum(len(p["text"]) for p in paras)
    if n < 5:
        issues.append("short")
    if chars < 1500:
        issues.append("low_text")
    sample = " ".join(p["text"] for p in paras)[:40000]
    if sample and (sample.count("�") >= 3 or garbled_share(sample) > 0.12):
        issues.append("garbled")
    nos = sorted({p["no"] for p in paras if isinstance(p.get("no"), int)})
    if n >= 10 and len(nos) >= n // 2 and nos and len(nos) / max(1, nos[-1]) < 0.6:
        issues.append("para_gaps")
    score = max(0, 100 - sum(CHECKS[i][0] for i in issues))
    return score, issues


def needs_ocr(issues: list) -> bool:
    return "garbled" in issues or "low_text" in issues


def run(store, progress=None, batch: int = 300) -> dict:
    """Score every judgment (skipping the demo fixtures) and store the result. Idempotent: run it again any time."""
    with closing(store.conn()) as c:
        rows = [dict(r) for r in c.execute("SELECT id, title, court, decision_date, year, citations FROM judgments "
                                           "WHERE source!='fixture'")]
    now = datetime.now().isoformat(timespec="seconds")
    done = 0
    for i in range(0, len(rows), batch):
        out = []
        with closing(store.conn()) as c:
            for j in rows[i:i + batch]:
                paras = [{"no": r["no"], "text": r["text"]} for r in
                         c.execute("SELECT no, text FROM paras WHERE jid=? ORDER BY id", (j["id"],))]
                score, issues = check_judgment(j, paras)
                out.append((j["id"], score, json.dumps(issues), now))
            c.executemany("INSERT OR REPLACE INTO quality(jid,score,issues,checked_at) VALUES(?,?,?,?)", out)
            c.commit()
        done += len(out)
        if progress:
            progress(f"Checked {done}/{len(rows)} judgments")
    with closing(store.conn()) as c:  # drop scores of judgments that no longer exist
        c.execute("DELETE FROM quality WHERE jid NOT IN (SELECT id FROM judgments)")
        c.commit()
    return {"checked": done}


def rescore(store, jid: str) -> Optional[dict]:
    """Score one judgment again (after a manual fix)."""
    with closing(store.conn()) as c:
        r = c.execute("SELECT id, title, court, decision_date, year, citations FROM judgments WHERE id=?", (jid,)).fetchone()
        if not r:
            return None
        paras = [{"no": p["no"], "text": p["text"]} for p in c.execute("SELECT no, text FROM paras WHERE jid=? ORDER BY id", (jid,))]
        score, issues = check_judgment(dict(r), paras)
        c.execute("INSERT OR REPLACE INTO quality(jid,score,issues,checked_at) VALUES(?,?,?,?)",
                  (jid, score, json.dumps(issues), datetime.now().isoformat(timespec="seconds")))
        c.commit()
    return {"score": score, "issues": issues}


def _norm_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def duplicate_groups(store, limit: int = 50) -> list:
    """Judgments that look like the same case stored twice under different ids: same court, date and case name.
    (Exact repeats of the same text are already caught when loading; this finds the ones whose text differs, for
    example the same judgment from two sources.)"""
    with closing(store.conn()) as c:
        rows = c.execute("SELECT id, title, court, decision_date, source, n_paras FROM judgments "
                         "WHERE source!='fixture' AND COALESCE(decision_date,'')!=''").fetchall()
    groups = defaultdict(list)
    for r in rows:
        groups[(r["court"], r["decision_date"], _norm_title(r["title"]))].append(dict(r))
    out = [{"court": k[0], "date": k[1], "title": v[0]["title"], "ids": [x["id"] for x in v],
            "sources": sorted({x["source"] for x in v}), "paras": [x["n_paras"] for x in v]}
           for k, v in groups.items() if len(v) > 1 and k[2]]
    out.sort(key=lambda g: -len(g["ids"]))
    return out[:limit]


def report(store) -> dict:
    with closing(store.conn()) as c:
        total = c.execute("SELECT COUNT(*) FROM judgments WHERE source!='fixture'").fetchone()[0]
        q = c.execute("SELECT q.jid, q.score, q.issues FROM quality q JOIN judgments j ON j.id=q.jid "
                      "WHERE j.source!='fixture'").fetchall()
        scanned = c.execute("SELECT COUNT(*) FROM skipped WHERE reason='scanned_or_empty'").fetchone()[0]
        dup_skipped = c.execute("SELECT COUNT(*) FROM skipped WHERE reason='duplicate'").fetchone()[0]
        tagged = c.execute("SELECT COUNT(*) FROM judgments WHERE source!='fixture' AND COALESCE(sections_tagged,0)=1").fetchone()[0]
        with_refs = c.execute("SELECT COUNT(DISTINCT jid) FROM section_refs").fetchone()[0]
    counts = Counter()
    buckets = {"90-100": 0, "70-89": 0, "50-69": 0, "0-49": 0}
    ocr = 0
    for r in q:
        iss = json.loads(r["issues"])
        counts.update(iss)
        s = r["score"]
        buckets["90-100" if s >= 90 else "70-89" if s >= 70 else "50-69" if s >= 50 else "0-49"] += 1
        ocr += needs_ocr(iss)
    n = len(q)
    return {
        "judgments": total, "scored": n, "stale": total - n,
        "average": round(sum(r["score"] for r in q) / n, 1) if n else None,
        "share_trustworthy": round(buckets["90-100"] / n, 3) if n else None,
        "buckets": buckets,
        "issues": [{"code": k, "label": CHECKS[k][1], "fix": CHECKS[k][2], "count": counts.get(k, 0)} for k in ORDER],
        "needs_ocr": ocr, "scanned_skipped": scanned, "duplicates_skipped": dup_skipped,
        "duplicate_groups": len(duplicate_groups(store, 10 ** 6)),
        "section_tagging": {"tagged": tagged, "with_refs": with_refs},
    }


def list_judgments(store, *, issue: Optional[str] = None, max_score: Optional[int] = None, limit: int = 50,
                   offset: int = 0) -> dict:
    sql = ("SELECT j.id, j.title, j.court, j.decision_date, j.year, j.source, j.source_url, j.n_paras, q.score, q.issues "
           "FROM quality q JOIN judgments j ON j.id=q.jid WHERE j.source!='fixture'")
    args: list = []
    if max_score is not None:
        sql += " AND q.score <= ?"
        args.append(max_score)
    if issue:
        if issue not in CHECKS:
            raise ValueError("unknown issue")
        sql += " AND q.issues LIKE ?"
        args.append(f'%"{issue}"%')
    with closing(store.conn()) as c:
        total = c.execute(f"SELECT COUNT(*) FROM ({sql})", args).fetchone()[0]
        rows = c.execute(sql + " ORDER BY q.score, j.id LIMIT ? OFFSET ?", args + [limit, offset]).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["issues"] = json.loads(d["issues"])
        items.append(d)
    return {"total": total, "items": items}


def export_csv(store, issue: Optional[str] = None, max_score: Optional[int] = None) -> str:
    data = list_judgments(store, issue=issue, max_score=max_score, limit=10 ** 6)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "score", "issues", "title", "court", "decision_date", "year", "paragraphs", "source", "source_url"])
    for r in data["items"]:
        w.writerow([r["id"], r["score"], ";".join(r["issues"]), r["title"], r["court"], r["decision_date"], r["year"],
                    r["n_paras"], r["source"], r["source_url"]])
    return buf.getvalue()


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    from .store import get_store

    store = get_store()
    if not argv or argv[0] == "run":
        print(run(store, progress=print))
        print(json.dumps(report(store), indent=2))
    elif argv[0] == "export" and len(argv) > 1:
        open(argv[1], "w", encoding="utf-8", newline="").write(export_csv(store))
        print("written", argv[1])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
