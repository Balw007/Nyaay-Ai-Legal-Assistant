"""Bare Acts library: the text of the Acts advocates cite, searchable by section, linked to the judgments that discuss them.

Stored in the same file as the judgment library (corpus.db). Nothing here is typed in from memory: text arrives from a
file or a public source through an importer, every import is checked, and a failed check means nothing is saved.

Sources and what they are:
  * civictech-India JSON (IPC, CrPC, CPC, Evidence Act, NI Act, Indian Divorce Act, Motor Vehicles Act) and the
    Constitution JSON: community copies of the government text. Useful, but they are NOT the official gazette and may
    lag amendments. Each Act records its source; the screen says "check against India Code before you cite".
  * Official PDF or text (India Code / Gazette / Legislative Department): any Act. Used for BNS, BNSS, BSA. The section
    splitter walks the numbers in order, and for the three Sanhitas the import is refused unless the number of sections
    equals the number in the Act (358, 531, 170).
  * Old -> new section mapping (IPC->BNS, CrPC->BNSS, Evidence Act->BSA): CC-BY-4.0 dataset.
"""
from __future__ import annotations

import hashlib
import json
import re
from contextlib import closing
from datetime import datetime
from typing import Optional

from .sections import ACTS, SHORT, act_label, sort_key

SCHEMA = """
CREATE TABLE IF NOT EXISTS acts(code TEXT PRIMARY KEY, name TEXT, short TEXT, year INTEGER, n_sections INTEGER DEFAULT 0,
  expected INTEGER, source TEXT, source_url TEXT, sha256 TEXT, imported_at TEXT, official INTEGER DEFAULT 0, notes TEXT);
CREATE TABLE IF NOT EXISTS sections(id INTEGER PRIMARY KEY, act TEXT NOT NULL, no TEXT NOT NULL, ord INTEGER,
  chapter TEXT, heading TEXT, text TEXT NOT NULL, UNIQUE(act, no));
CREATE INDEX IF NOT EXISTS sections_act ON sections(act, ord);
CREATE TABLE IF NOT EXISTS act_map(old_act TEXT NOT NULL, old_no TEXT NOT NULL, new_act TEXT NOT NULL, new_no TEXT NOT NULL,
  status TEXT, note TEXT, PRIMARY KEY(old_act, old_no, new_act, new_no));
CREATE INDEX IF NOT EXISTS act_map_new ON act_map(new_act, new_no);
"""
SCHEMA_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(heading, text, content='sections', content_rowid='id',
  tokenize='porter unicode61');
"""

# Number of sections in each Act as enacted. An import that does not match is refused.
EXPECTED = {"bns": 358, "bnss": 531, "bsa": 170}

RAW = "https://raw.githubusercontent.com"
_CT = f"{RAW}/civictech-India/Indian-Law-Penal-Code-Json/main"
_MAP = f"{RAW}/GSMS-B/ipc-bns-crpc-bnss-iea-bsa-respective-old-new-sections-mapping/main"
# code -> (url, parser). HMA's file in that repository is not valid JSON-by-field, so it is left out on purpose.
CATALOG = {
    "ipc": {"url": f"{_CT}/ipc.json", "kind": "civictech"},
    "crpc": {"url": f"{_CT}/crpc.json", "kind": "civictech"},
    "cpc": {"url": f"{_CT}/cpc.json", "kind": "civictech"},
    "iea": {"url": f"{_CT}/iea.json", "kind": "civictech"},
    "ni": {"url": f"{_CT}/nia.json", "kind": "civictech"},
    "mv": {"url": f"{_CT}/MVA.json", "kind": "civictech"},
    "const": {"url": f"{RAW}/civictech-India/constitution-of-india/main/constitution_of_india.json", "kind": "constitution"},
}
MAPPINGS = {"ipc_to_bns": f"{_MAP}/ipc_to_bns.json", "crpc_to_bnss": f"{_MAP}/crpc_to_bnss.json",
            "iea_to_bsa": f"{_MAP}/iea_to_bsa.json"}
_MAP_CODES = {"Indian Penal Code, 1860": "ipc", "Bharatiya Nyaya Sanhita, 2023": "bns",
              "Code of Criminal Procedure, 1973": "crpc", "Bharatiya Nagarik Suraksha Sanhita, 2023": "bnss",
              "Indian Evidence Act, 1872": "iea", "Bharatiya Sakshya Adhiniyam, 2023": "bsa"}


class ActImportError(ValueError):
    """The file is not what it should be. Nothing was saved."""


# ------------------------------------------------------------------ cleaning and parsing

def clean_no(raw) -> str:
    """138 -> '138'; '153B.' -> '153B'; ' 141 a ' -> '141A'; 'Article 21' -> '21'."""
    s = re.sub(r"(?i)^(?:section|article|art\.?|s\.?)\s*", "", str(raw).strip())
    return re.sub(r"[\s.]+", "", s).upper()


def clean_text(t) -> str:
    t = str(t or "").replace("\r", "")
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\n[ \t]*\n(?:[ \t]*\n)+", "\n\n", t)
    return t.strip()


def parse_civictech(data) -> list:
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ActImportError("not a list of sections")
    rows = []
    for d in data:
        no = next((d[k] for k in ("section", "Section") if k in d), None)
        if no is None:
            raise ActImportError("this file has no 'section' field (for example, the Hindu Marriage Act file in this "
                                 "source is damaged). Use the official PDF instead.")
        rows.append({"no": clean_no(no), "heading": clean_text(d.get("section_title") or d.get("title")),
                     "text": clean_text(d.get("section_desc") or d.get("description")),
                     "chapter": clean_text(d.get("chapter_title") or (f"Chapter {d['chapter']}" if d.get("chapter") else ""))})
    return rows


def parse_constitution(data) -> list:
    if not isinstance(data, list) or not data or "article" not in data[0]:
        raise ActImportError("not the Constitution file")
    return [{"no": clean_no(d["article"]), "heading": clean_text(d.get("title")), "text": clean_text(d.get("description")),
             "chapter": ""} for d in data]


_START = re.compile(r"^\s*(\d{1,3})\s?([A-Z]{0,2})\s*\.\s+(?=\S)")


def _strip_running(lines: list) -> list:
    """Remove page numbers and headers/footers that repeat on every page."""
    from collections import Counter

    c = Counter(ln.strip() for ln in lines if 3 <= len(ln.strip()) <= 90)
    repeated = {t for t, n in c.items() if n >= 8 and not _START.match(t)}
    return [ln for ln in lines if ln.strip() not in repeated and not re.fullmatch(r"\s*(?:page\s+)?[ivxlc\d]{1,5}\s*", ln, re.I)]


def _follows(a: tuple, b: tuple, max_gap: int) -> bool:
    """Can section b come right after section a? Same number with a later letter (141 -> 141A -> 141B), or the next
    number (or, when gaps are allowed, one a little further on)."""
    (na, la), (nb, lb) = a, b
    if nb == na and lb and lb > la:
        return True
    return lb == "" and 1 <= nb - na <= 1 + max_gap


def parse_official_text(raw: str, expected: Optional[int] = None) -> list:
    """Split the text of an Act (from a PDF or text file) into sections.

    A section starts at a line like '103. Punishment for murder.\u2014(1) Whoever ...'. Candidate starts are lines that
    begin with a number and a full stop. The sections are the longest in-order chain of such numbers (1, 2, 3, ... with
    letters like 141A in their place); a stray '1.' in a list inside a section, a page number, or an 'arrangement of
    sections' table at the front does not break or replace the real chain. When two chains are equally long the later
    one wins, because the table of contents comes before the text. If the count is known (`expected`) no gaps in the
    numbering are allowed and the count must match, otherwise nothing is returned."""
    lines = _strip_running([ln.rstrip() for ln in raw.replace("\r", "").split("\n")])
    cands = []  # (line index, (number, letter), how much it looks like a real section opening)
    for i, ln in enumerate(lines):
        m = _START.match(ln)
        if m:
            head, _ = _split_heading(ln[m.end():].strip())
            dash = bool(re.match(r"^.{3,200}?\s*[.\u2014\u2013-]{1,3}\s*[\u2014\u2013-]", ln[m.end():].strip()))
            cands.append((i, (int(m.group(1)), m.group(2).upper()), 2 if dash else 1 if head else 0))
    gap = 0 if expected else 2
    best: list = []  # best[k] = (chain length, opening-look score, sum of line indexes, previous k)
    for k, (i, key, w) in enumerate(cands):
        top = (1, w, i, -1) if key == (1, "") else (0, 0, 0, -1)
        for j in range(k - 1, max(-1, k - 400), -1):
            if best[j][0] and _follows(cands[j][1], key, gap):
                cand = (best[j][0] + 1, best[j][1] + w, best[j][2] + i, j)
                if cand[:3] > top[:3]:
                    top = cand
        best.append(top)
    if not cands or max(b[0] for b in best) == 0:
        raise ActImportError("no sections found. Is this a scanned PDF? Run it through OCR first.")
    k = max(range(len(best)), key=lambda x: best[x][:3])
    chain = []
    while k != -1:
        chain.append(k)
        k = best[k][3]
    chain.reverse()
    rows = []
    for pos, k in enumerate(chain):
        i, (n, letter), _w = cands[k]
        end = cands[chain[pos + 1]][0] if pos + 1 < len(chain) else len(lines)
        first = _START.sub("", lines[i], count=1).strip()
        head, body = _split_heading(first)
        text = "\n".join([body] + lines[i + 1:end])
        rows.append({"no": f"{n}{letter}", "heading": head, "text": clean_text(text), "chapter": ""})
    if expected is not None and len(rows) != expected:
        raise ActImportError(f"found {len(rows)} sections but this Act has {expected}. Nothing was saved; the PDF may "
                             "be scanned or have an unusual layout. Convert it to text and check the numbering.")
    return rows


def _split_heading(rest: str) -> tuple:
    """'Punishment for murder.—(1) Whoever ...' -> ('Punishment for murder', '(1) Whoever ...')."""
    m = re.match(r"^(.{3,200}?)\s*[.—–-]{1,3}\s*[—–-]\s*(.*)$", rest)
    if m:
        return m.group(1).strip(" .—-"), m.group(2)
    m = re.match(r"^(.{3,160}?)\.\s*$", rest)
    if m:
        return m.group(1), ""
    return "", rest


def parse_mapping(data) -> list:
    if not isinstance(data, list) or not data or "source" not in data[0] or "target" not in data[0]:
        raise ActImportError("not a section-mapping file")
    rows = []
    for d in data:
        so, ta = d["source"], d["target"]
        oa, na = _MAP_CODES.get(so.get("act")), _MAP_CODES.get(ta.get("act")) if ta else None
        if not oa:
            continue
        if not ta or not ta.get("section"):  # a deleted provision has no new number
            rows.append((oa, clean_no(so["section"]), "", "", d.get("status") or "", (d.get("mapping_statement") or "")[:600]))
            continue
        if not na:
            continue
        rows.append((oa, clean_no(so["section"]), na, clean_no(ta["section"]), d.get("status") or "",
                     (d.get("mapping_statement") or "")[:600]))
    return rows


# ------------------------------------------------------------------ checking

def check_sections(code: str, rows: list) -> dict:
    """Problems found in a set of sections. Returned, not raised: the caller decides what is fatal."""
    nos = [r["no"] for r in rows]
    dup = sorted({n for n in nos if nos.count(n) > 1}, key=sort_key)
    empty = [r["no"] for r in rows if not r["text"]]
    base = sorted({int(re.match(r"\d+", n).group()) for n in nos if re.match(r"\d+", n)})
    gaps = [i for i in range(base[0], base[-1] + 1) if i not in set(base)] if base and code != "const" else []
    exp = EXPECTED.get(code)
    return {"count": len(rows), "expected": exp, "duplicates": dup, "empty_text": empty, "missing_numbers": gaps[:200],
            "n_missing": len(gaps), "ok": not dup and (exp is None or exp == len(set(nos)))}


# ------------------------------------------------------------------ storage

def save_act(store, code: str, rows: list, *, source: str, source_url: str = "", official: bool = False,
             name: str = "", year: Optional[int] = None, notes: str = "", sha256: str = "") -> dict:
    """Replace the stored text of an Act. Refuses (ActImportError) when the checks fail; then nothing changes."""
    if code not in ACTS:
        raise ActImportError(f"unknown Act code '{code}'")
    rows = _unique(rows)
    rep = check_sections(code, rows)
    if rep["expected"] and rep["count"] != rep["expected"]:
        raise ActImportError(f"{rep['count']} sections found but {code.upper()} has {rep['expected']}")
    if not rows:
        raise ActImportError("no sections")
    label = name or act_label(code)
    with closing(store.conn()) as c:
        try:
            for r in c.execute("SELECT id, heading, text FROM sections WHERE act=?", (code,)).fetchall():
                c.execute("INSERT INTO sections_fts(sections_fts, rowid, heading, text) VALUES('delete', ?, ?, ?)",
                          (r["id"], r["heading"], r["text"]))
            c.execute("DELETE FROM sections WHERE act=?", (code,))
            for i, r in enumerate(rows):
                cur = c.execute("INSERT INTO sections(act,no,ord,chapter,heading,text) VALUES(?,?,?,?,?,?)",
                                (code, r["no"], i, r.get("chapter", ""), r.get("heading", ""), r["text"]))
                c.execute("INSERT INTO sections_fts(rowid, heading, text) VALUES(?,?,?)",
                          (cur.lastrowid, r.get("heading", ""), r["text"]))
            yr = year or _year_of(label)
            c.execute("INSERT OR REPLACE INTO acts(code,name,short,year,n_sections,expected,source,source_url,sha256,"
                      "imported_at,official,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                      (code, label, SHORT.get(code, code), yr, len(rows), EXPECTED.get(code), source, source_url, sha256,
                       datetime.now().isoformat(timespec="seconds"), int(official),
                       notes or json.dumps({k: rep[k] for k in ("empty_text", "n_missing", "duplicates")})))
            c.commit()
        except Exception:
            c.rollback()
            raise
    return rep


def _unique(rows):
    seen, out = set(), []
    for r in rows:
        if r["no"] in seen or not r["no"]:
            continue
        seen.add(r["no"])
        out.append(r)
    return out


def _year_of(label: str) -> Optional[int]:
    m = re.search(r"(1[89]\d\d|20\d\d)", label)
    return int(m.group(1)) if m else None


def save_mapping(store, rows: list) -> int:
    with closing(store.conn()) as c:
        olds = {(r[0]) for r in rows}
        for o in olds:
            c.execute("DELETE FROM act_map WHERE old_act=?", (o,))
        c.executemany("INSERT OR REPLACE INTO act_map VALUES(?,?,?,?,?,?)", rows)
        c.commit()
    return len(rows)


def import_json_text(store, code: str, raw: bytes, url: str = "") -> dict:
    """Import one Act from the bytes of a catalogue file."""
    kind = CATALOG[code]["kind"]
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except Exception as exc:
        raise ActImportError(f"not valid JSON: {exc}") from exc
    rows = parse_constitution(data) if kind == "constitution" else parse_civictech(data)
    return save_act(store, code, rows, source="civictech-India (community copy of government text)", source_url=url,
                    official=False, sha256=hashlib.sha256(raw).hexdigest())


def import_official(store, code: str, raw_text: str, source_url: str = "", filename: str = "") -> dict:
    rows = parse_official_text(raw_text, expected=EXPECTED.get(code))
    return save_act(store, code, rows, source=f"Official text{(' ' + filename) if filename else ''}",
                    source_url=source_url, official=True, sha256=hashlib.sha256(raw_text.encode()).hexdigest())


def download(url: str, timeout: float = 60) -> bytes:
    import httpx

    r = httpx.get(url, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    return r.content


def import_catalog(store, codes=None, progress=print, fetch=download) -> dict:
    """Download and import the catalogue Acts and the old->new mappings. One bad file does not stop the others."""
    out = {"imported": [], "failed": {}}
    for code in codes or list(CATALOG):
        try:
            raw = fetch(CATALOG[code]["url"])
            rep = import_json_text(store, code, raw, CATALOG[code]["url"])
            progress(f"{act_label(code)}: {rep['count']} sections")
            out["imported"].append(code)
        except Exception as exc:
            out["failed"][code] = str(exc)[:300]
            progress(f"{code}: skipped ({exc})")
    if codes is None:
        total = 0
        for name, url in MAPPINGS.items():
            try:
                total += save_mapping(store, parse_mapping(json.loads(fetch(url).decode("utf-8-sig"))))
            except Exception as exc:
                out["failed"][name] = str(exc)[:300]
        if total:
            out["mapping_rows"] = total
            progress(f"Old to new section mapping: {total} rows")
    return out


# ------------------------------------------------------------------ reading

def list_acts(store) -> list:
    with closing(store.conn()) as c:
        have = {r["code"]: dict(r) for r in c.execute("SELECT * FROM acts")}
        cited = {r["act"]: r["n"] for r in c.execute(
            "SELECT act, COUNT(DISTINCT jid) n FROM section_refs GROUP BY act")}
    out = []
    for code, (name, _) in ACTS.items():
        a = have.get(code)
        out.append({"code": code, "name": (a or {}).get("name") or name, "short": SHORT.get(code, code),
                    "loaded": bool(a), "n_sections": (a or {}).get("n_sections", 0), "official": bool((a or {}).get("official")),
                    "source": (a or {}).get("source", ""), "imported_at": (a or {}).get("imported_at"),
                    "expected": EXPECTED.get(code), "judgments": cited.get(code, 0)})
    out.sort(key=lambda a: (not a["loaded"], -a["judgments"], a["name"]))
    return out


def get_act(store, code: str) -> Optional[dict]:
    with closing(store.conn()) as c:
        a = c.execute("SELECT * FROM acts WHERE code=?", (code,)).fetchone()
        if not a:
            return None
        secs = [dict(r) for r in c.execute("SELECT no, heading, chapter, ord FROM sections WHERE act=? ORDER BY ord", (code,))]
        cnt = {r["section"]: r["n"] for r in c.execute(
            "SELECT section, COUNT(DISTINCT jid) n FROM section_refs WHERE act=? GROUP BY section", (code,))}
    for s in secs:
        s["judgments"] = cnt.get(s["no"], 0)
    d = dict(a)
    d["sections"] = secs
    return d


def get_section(store, code: str, no: str) -> Optional[dict]:
    no = clean_no(no)
    with closing(store.conn()) as c:
        s = c.execute("SELECT s.*, a.name act_name, a.official, a.source FROM sections s JOIN acts a ON a.code=s.act "
                      "WHERE s.act=? AND s.no=?", (code, no)).fetchone()
        if not s:
            return None
        d = dict(s)
        nb = c.execute("SELECT no, heading FROM sections WHERE act=? AND ord IN (?,?) ORDER BY ord", (code, s["ord"] - 1, s["ord"] + 1)).fetchall()
        d["prev"] = next((dict(r) for r in nb if r["no"] != no and _before(c, code, r["no"], s["ord"])), None)
        d["next"] = next((dict(r) for r in nb if r["no"] != no and not _before(c, code, r["no"], s["ord"])), None)
        d["old"] = [dict(r) for r in c.execute("SELECT old_act, old_no, status, note FROM act_map WHERE new_act=? AND new_no=?", (code, no))]
        d["new"] = [dict(r) for r in c.execute("SELECT new_act, new_no, status, note FROM act_map WHERE old_act=? AND old_no=? AND new_no!=''", (code, no))]
        deleted = c.execute("SELECT status, note FROM act_map WHERE old_act=? AND old_no=? AND new_no=''", (code, no)).fetchone()
        d["deleted_in_new"] = dict(deleted) if deleted else None
        d["judgments"] = c.execute("SELECT COUNT(DISTINCT jid) FROM section_refs WHERE act=? AND section=?", (code, no)).fetchone()[0]
    return d


def _before(c, code, no, ord_):
    r = c.execute("SELECT ord FROM sections WHERE act=? AND no=?", (code, no)).fetchone()
    return bool(r) and r["ord"] < ord_


def search_sections(store, q: str, act: Optional[str] = None, limit: int = 30) -> list:
    """Section number first ('138', '138 ni'), then words in the heading and text."""
    q = q.strip()
    out, seen = [], set()
    with closing(store.conn()) as c:
        m = re.fullmatch(r"(?:s(?:ec(?:tion)?)?\.?\s*)?(\d{1,4}[A-Za-z]{0,3})(?:\s+(?:of\s+)?(.+))?", q, re.I)
        if m:
            no = clean_no(m.group(1))
            code = act
            if m.group(2):
                from .sections import _act_after

                code = _act_after(" " + m.group(2), 0) or act
            sql, args = "SELECT s.act, s.no, s.heading, a.short FROM sections s JOIN acts a ON a.code=s.act WHERE s.no=?", [no]
            if code:
                sql += " AND s.act=?"
                args.append(code)
            for r in c.execute(sql + " ORDER BY a.n_sections DESC", args):
                out.append({"act": r["act"], "short": r["short"], "no": r["no"], "heading": r["heading"], "snippet": "",
                            "exact": True})
                seen.add((r["act"], r["no"]))
        from .store import fts_query

        fq = fts_query(q, "and") or None
        if fq:
            sql = ("SELECT s.act, s.no, s.heading, a.short, snippet(sections_fts, 1, '<mark>', '</mark>', ' ... ', 28) snip "
                   "FROM sections_fts JOIN sections s ON s.id=sections_fts.rowid JOIN acts a ON a.code=s.act "
                   "WHERE sections_fts MATCH ?")
            args = [fq]
            if act:
                sql += " AND s.act=?"
                args.append(act)
            for r in c.execute(sql + " ORDER BY bm25(sections_fts, 4.0, 1.0) LIMIT ?", args + [limit]):
                if (r["act"], r["no"]) not in seen:
                    out.append({"act": r["act"], "short": r["short"], "no": r["no"], "heading": r["heading"],
                                "snippet": r["snip"], "exact": False})
    return out[:limit]


def section_judgments(store, code: str, no: str, limit: int = 50) -> list:
    """Judgments in the library that discuss this section, those that discuss it most first."""
    no = clean_no(no)
    with closing(store.conn()) as c:
        rows = c.execute(
            "SELECT j.id, j.title, j.court, j.year, j.citations, COUNT(*) n, GROUP_CONCAT(r.para_no) paras, "
            "MIN(r.inferred) explicit_first FROM section_refs r JOIN judgments j ON j.id=r.jid "
            "WHERE r.act=? AND r.section=? GROUP BY j.id ORDER BY n DESC, j.year DESC LIMIT ?", (code, no, limit)).fetchall()
    out = []
    for r in rows:
        paras = sorted({int(p) for p in (r["paras"] or "").split(",") if p.strip().lstrip("-").isdigit()})
        cit = json.loads(r["citations"] or "[]")
        out.append({"id": r["id"], "title": r["title"], "court": r["court"], "year": r["year"],
                    "citation": cit[0] if cit else "", "mentions": r["n"], "paras": paras[:12]})
    return out
