"""Judgment store: SQLite with FTS5 full-text search at paragraph level.

One file (corpus.db), no server needed. Holds judgments, numbered paragraphs, a citation index
and a cites graph. The citation checker, the search page and the AI assistant all read from here.
"""
from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Optional

from ..config import CORPUS_DB, DATA_DIR
from . import acts, sections
from .citations import NAME_STOP, Judgment, extract_norms, name_match, normalize_any

SCHEMA = """
CREATE TABLE IF NOT EXISTS judgments(
  id TEXT PRIMARY KEY, title TEXT, court TEXT, decision_date TEXT, year INTEGER,
  citations TEXT, bench TEXT, disposal TEXT, source TEXT, source_url TEXT,
  n_paras INTEGER DEFAULT 0, summary TEXT);
CREATE INDEX IF NOT EXISTS judgments_year ON judgments(year);
CREATE INDEX IF NOT EXISTS judgments_court ON judgments(court);
CREATE TABLE IF NOT EXISTS paras(id INTEGER PRIMARY KEY, jid TEXT NOT NULL, no INTEGER, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS paras_jid ON paras(jid);
CREATE TABLE IF NOT EXISTS cite_index(norm TEXT PRIMARY KEY, jid TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cites(src TEXT NOT NULL, norm TEXT NOT NULL, para_no INTEGER, treatment TEXT);
CREATE INDEX IF NOT EXISTS cites_norm ON cites(norm);
CREATE INDEX IF NOT EXISTS cites_src ON cites(src);
CREATE TABLE IF NOT EXISTS cite_pairs(a TEXT NOT NULL, b TEXT NOT NULL, src TEXT, PRIMARY KEY(a, b));
CREATE TABLE IF NOT EXISTS para_vec(pid INTEGER PRIMARY KEY, vec BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS skipped(id TEXT PRIMARY KEY, reason TEXT NOT NULL, of_jid TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS section_refs(jid TEXT NOT NULL, para_no INTEGER, act TEXT NOT NULL, section TEXT NOT NULL,
  inferred INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS section_refs_sec ON section_refs(act, section);
CREATE INDEX IF NOT EXISTS section_refs_jid ON section_refs(jid);
CREATE TABLE IF NOT EXISTS quality(jid TEXT PRIMARY KEY, score INTEGER NOT NULL, issues TEXT NOT NULL, checked_at TEXT);
CREATE INDEX IF NOT EXISTS quality_score ON quality(score);
"""
SCHEMA += acts.SCHEMA
SCHEMA_FTS = acts.SCHEMA_FTS + """
CREATE VIRTUAL TABLE IF NOT EXISTS paras_fts USING fts5(text, content='paras', content_rowid='id',
  tokenize='porter unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS titles_fts USING fts5(jid UNINDEXED, title, tokenize='porter unicode61');
"""

QUERY_STOP = set("a an the of and or to in on for by with as at is are was were be been this that it its from "
                 "not no what which who whom whether how can may shall under any such if when does do did".split())


class FTS5Unavailable(RuntimeError):
    pass


# Words lawyers use interchangeably. A query term matches any word in its group.
SYNONYMS = [
    ["cheque", "check"],
    ["dishonour", "dishonor", "dishonoured", "bounce", "bounced", "bouncing", "returned unpaid", "unpaid"],
    ["accused", "drawer"], ["complainant", "payee"],
    ["limitation", "delay", "condonation", "condone", "time barred", "barred"],
    ["director", "directors", "officer", "officers"],
    ["quash", "quashing", "quashed"], ["presumption", "presume", "presumed"],
    ["rebut", "rebuttal", "rebuttable", "rebutted"], ["debt", "liability", "dues"],
    ["compensation", "fine"], ["jurisdiction", "territorial"], ["notice", "intimation"],
    ["security", "guarantee", "collateral"], ["maintenance", "alimony"], ["arbitration", "arbitral"],
    ["injunction", "restraint"], ["eviction", "ejectment"], ["acquittal", "acquitted"],
    ["conviction", "convicted"], ["adjournment", "adjourned"], ["evidence", "proof"],
]
_SYN = {}
for _g in SYNONYMS:
    for _w in _g:
        if " " not in _w:
            _SYN.setdefault(_w, set()).update(_g)


def _q(term: str) -> str:
    return '"' + re.sub(r'[^A-Za-z0-9 ]', ' ', term).strip() + '"'


def query_terms(q: str) -> tuple:
    phrases = [p.strip() for p in re.findall(r'"([^"]+)"', q) if p.strip()]
    rest = re.sub(r'"[^"]+"', " ", q)
    toks = [t for t in re.findall(r"[A-Za-z0-9]+", rest.lower()) if t not in QUERY_STOP and len(t) > 1]
    return phrases, list(dict.fromkeys(toks))


def fts_query(q: str, mode: str = "and", max_terms: int = 14, expand: bool = True) -> Optional[str]:
    """Free text -> safe FTS5 query. Quoted phrases stay exact; other words also match their synonyms.
    Nothing the user types can break the query syntax."""
    phrases, toks = query_terms(q)
    if mode == "or":
        toks = sorted(toks, key=lambda t: (-len(t), t))[:max_terms]
    groups = [[_q(p)] for p in phrases]
    for t in toks:
        alts = sorted(_SYN.get(t, {t})) if expand else [t]
        groups.append([_q(a) for a in alts if a.strip()])
    groups = [g for g in groups if g]
    if not groups:
        return None
    if mode == "or":
        return " OR ".join(dict.fromkeys(x for g in groups for x in g))
    return " AND ".join(g[0] if len(g) == 1 else "(" + " OR ".join(g) + ")" for g in groups)


def highlight(text: str, q: str, width: int = 260) -> str:
    """Snippet with <mark> around query words, for results that came from semantic search."""
    phrases, toks = query_terms(q)
    words = set(toks) | {w for t in toks for w in _SYN.get(t, ())}
    pat = re.compile(r"\b(" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")\w*",
                     re.I) if words else None
    m = pat.search(text) if pat else None
    start = max(0, (m.start() if m else 0) - width // 3)
    snip = text[start:start + width]
    snip = (" ... " if start else "") + snip + (" ... " if start + width < len(text) else "")
    return pat.sub(lambda x: "<mark>" + x.group(0) + "</mark>", snip) if pat else snip


NEUTRAL_RE = re.compile(r"\d{4} INSC \d+")


def normalize_any_all(raw: str) -> set:
    return extract_norms(raw or "")


def text_hash(paragraphs: list) -> str:
    """Fingerprint of a judgment's words: the same judgment from two sources (or two PDFs) hashes the same."""
    import hashlib

    words = re.sub(r"[^a-z0-9\u0900-\u097f]+", " ", " ".join(p.get("text", "") for p in paragraphs).lower()).split()
    return hashlib.sha1(" ".join(words).encode()).hexdigest() if len(words) >= 30 else ""


def _first_cite(raw: Optional[str]) -> str:
    try:
        lst = json.loads(raw or "[]")
    except ValueError:
        lst = []
    return lst[0] if lst else ""


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self.conn()) as c:
            c.executescript(SCHEMA)
            cols = {r[1] for r in c.execute("PRAGMA table_info(cites)")}
            for col, typ in (("para_no", "INTEGER"), ("treatment", "TEXT")):
                if col not in cols:
                    c.execute(f"ALTER TABLE cites ADD COLUMN {col} {typ}")
            jcols = {r[1] for r in c.execute("PRAGMA table_info(judgments)")}
            if "text_hash" not in jcols:  # libraries built before de-duplication
                c.execute("ALTER TABLE judgments ADD COLUMN text_hash TEXT")
            if "sections_tagged" not in jcols:  # libraries built before section tagging
                c.execute("ALTER TABLE judgments ADD COLUMN sections_tagged INTEGER DEFAULT 0")
            c.execute("CREATE INDEX IF NOT EXISTS judgments_text_hash ON judgments(text_hash)")
            try:
                c.executescript(SCHEMA_FTS)
            except sqlite3.OperationalError as exc:
                raise FTS5Unavailable(
                    "This Python's SQLite was built without FTS5, which search needs. "
                    "Install a newer Python from python.org, or run: pip install pysqlite3-binary") from exc
            c.commit()

    def conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        return c

    # ------------------------------------------------------------ writing
    def _remove(self, c: sqlite3.Connection, jid: str) -> None:
        c.execute("DELETE FROM para_vec WHERE pid IN (SELECT id FROM paras WHERE jid=?)", (jid,))
        for r in c.execute("SELECT id, text FROM paras WHERE jid=?", (jid,)).fetchall():
            c.execute("INSERT INTO paras_fts(paras_fts, rowid, text) VALUES('delete', ?, ?)", (r["id"], r["text"]))
        c.execute("DELETE FROM paras WHERE jid=?", (jid,))
        c.execute("DELETE FROM titles_fts WHERE jid=?", (jid,))
        c.execute("DELETE FROM cite_index WHERE jid=?", (jid,))
        c.execute("DELETE FROM cites WHERE src=?", (jid,))
        c.execute("DELETE FROM section_refs WHERE jid=?", (jid,))
        c.execute("DELETE FROM quality WHERE jid=?", (jid,))
        c.execute("DELETE FROM para_vec WHERE pid IN (SELECT id FROM paras WHERE jid=?)", (jid,))
        c.execute("DELETE FROM judgments WHERE id=?", (jid,))

    last_skip: Optional[str] = None  # why the most recent add_judgment returned False: "exists" or "duplicate"

    def add_judgment(self, rec: dict, replace: bool = False) -> bool:
        """rec: id, title, court, decision_date, year, citations[], bench, disposal, source, source_url,
        paragraphs[{no,text}], own_norms[], cite_norms[]. Returns False when skipped: already present under this
        id, or the same judgment (same text, or same neutral citation) is already stored under another id."""
        th = rec.get("text_hash") or text_hash(rec["paragraphs"])
        with closing(self.conn()) as c:
            try:
                exists = c.execute("SELECT 1 FROM judgments WHERE id=?", (rec["id"],)).fetchone()
                if exists and not replace:
                    self.last_skip = "exists"
                    return False
                if not exists:
                    dup = self._duplicate_of(c, rec, th)
                    if dup:
                        c.execute("INSERT OR REPLACE INTO skipped(id, reason, of_jid) VALUES(?,?,?)",
                                  (rec["id"], "duplicate", dup))
                        c.commit()
                        self.last_skip = "duplicate"
                        return False
                if exists:
                    self._remove(c, rec["id"])
                c.execute(
                    "INSERT INTO judgments(id,title,court,decision_date,year,citations,bench,disposal,source,"
                    "source_url,n_paras,text_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (rec["id"], rec["title"], rec.get("court", ""), rec.get("decision_date", ""), rec.get("year"),
                     json.dumps(rec.get("citations", [])), rec.get("bench", ""), rec.get("disposal", ""),
                     rec.get("source", ""), rec.get("source_url", ""), len(rec["paragraphs"]), th))
                for p in rec["paragraphs"]:
                    cur = c.execute("INSERT INTO paras(jid,no,text) VALUES(?,?,?)", (rec["id"], p["no"], p["text"]))
                    c.execute("INSERT INTO paras_fts(rowid,text) VALUES(?,?)", (cur.lastrowid, p["text"]))
                c.execute("INSERT INTO titles_fts(jid,title) VALUES(?,?)", (rec["id"], rec["title"]))
                self._tag(c, rec["id"], rec["paragraphs"])
                own = set(rec.get("own_norms", []))
                for n in own:
                    c.execute("INSERT OR IGNORE INTO cite_index(norm,jid) VALUES(?,?)", (n, rec["id"]))
                refs = rec.get("cite_refs")
                if refs is None:
                    refs = [{"norm": n, "para_no": None, "treatment": "cited"} for n in rec.get("cite_norms", [])]
                for r in refs:
                    if r["norm"] not in own:
                        c.execute("INSERT INTO cites(src,norm,para_no,treatment) VALUES(?,?,?,?)",
                                  (rec["id"], r["norm"], r.get("para_no"), r.get("treatment") or "cited"))
                for a, b in rec.get("cite_pairs", []):
                    c.execute("INSERT OR IGNORE INTO cite_pairs(a,b,src) VALUES(?,?,?)", (a, b, rec["id"]))
                c.commit()
                self.last_skip = None
                return True
            except Exception:
                c.rollback()
                raise

    @staticmethod
    def _tag(c: sqlite3.Connection, jid: str, paragraphs: list) -> int:
        """Record which Acts and sections each paragraph of a judgment refers to (see services/sections.py)."""
        c.execute("DELETE FROM section_refs WHERE jid=?", (jid,))
        rows = sections.tag_paragraphs(paragraphs)
        c.executemany("INSERT INTO section_refs(jid,para_no,act,section,inferred) VALUES(?,?,?,?,?)",
                      [(jid, no, act, sec, inf) for no, act, sec, inf in rows])
        c.execute("UPDATE judgments SET sections_tagged=1 WHERE id=?", (jid,))
        return len(rows)

    def retag(self, progress=None, everything: bool = False) -> dict:
        """Tag judgments that were stored before tagging existed (or all of them, after the rules improve)."""
        with closing(self.conn()) as c:
            ids = [r["id"] for r in c.execute(
                "SELECT id FROM judgments" + ("" if everything else " WHERE COALESCE(sections_tagged,0)=0"))]
        done = refs = 0
        for i in range(0, len(ids), 200):
            with closing(self.conn()) as c:
                for jid in ids[i:i + 200]:
                    paras = [{"no": r["no"], "text": r["text"]} for r in
                             c.execute("SELECT no, text FROM paras WHERE jid=? ORDER BY id", (jid,))]
                    refs += self._tag(c, jid, paras)
                    done += 1
                c.commit()
            if progress:
                progress(f"Tagged {done}/{len(ids)} judgments with the Acts and sections they discuss")
        return {"judgments": done, "refs": refs}

    def judgment_sections(self, jid: str) -> list:
        """[{act, section, paras[], inferred, heading}] for one judgment, most-mentioned first."""
        with closing(self.conn()) as c:
            rows = c.execute("SELECT act, section, para_no, inferred FROM section_refs WHERE jid=?", (jid,)).fetchall()
            heads = {(r["act"], r["no"]): r["heading"] for r in c.execute(
                "SELECT act, no, heading FROM sections WHERE act IN (SELECT DISTINCT act FROM section_refs WHERE jid=?)", (jid,))}
        by: dict = {}
        for r in rows:
            g = by.setdefault((r["act"], r["section"]), {"act": r["act"], "act_name": sections.SHORT.get(r["act"], r["act"]),
                                                         "section": r["section"], "paras": [], "inferred": True,
                                                         "heading": heads.get((r["act"], r["section"]), "")})
            if r["para_no"] is not None:
                g["paras"].append(r["para_no"])
            g["inferred"] = g["inferred"] and bool(r["inferred"])
        out = list(by.values())
        out.sort(key=lambda g: (-len(g["paras"]), g["act"], sections.sort_key(g["section"])))
        return out

    def section_facets(self, act: Optional[str] = None, limit: int = 40) -> list:
        """The Acts (or, for one Act, the sections) the library talks about most, with judgment counts."""
        with closing(self.conn()) as c:
            if act:
                rows = c.execute("SELECT act, section, COUNT(DISTINCT jid) n FROM section_refs WHERE act=? "
                                 "GROUP BY section ORDER BY n DESC LIMIT ?", (act, limit)).fetchall()
            else:
                rows = c.execute("SELECT act, '' section, COUNT(DISTINCT jid) n FROM section_refs GROUP BY act "
                                 "ORDER BY n DESC LIMIT ?", (limit,)).fetchall()
        return [{"act": r["act"], "name": sections.SHORT.get(r["act"], r["act"]), "section": r["section"], "judgments": r["n"]}
                for r in rows]

    def jids_with_section(self, act: str, section: Optional[str] = None) -> set:
        with closing(self.conn()) as c:
            if section:
                rows = c.execute("SELECT DISTINCT jid FROM section_refs WHERE act=? AND section=?",
                                 (act, acts.clean_no(section)))
            else:
                rows = c.execute("SELECT DISTINCT jid FROM section_refs WHERE act=?", (act,))
            return {r["jid"] for r in rows}

    @staticmethod
    def _duplicate_of(c: sqlite3.Connection, rec: dict, th: str) -> Optional[str]:
        """The id of a stored judgment that is this same judgment, if any."""
        if th:
            r = c.execute("SELECT id FROM judgments WHERE text_hash=? LIMIT 1", (th,)).fetchone()
            if r:
                return r["id"]
        listed = " ; ".join(rec.get("citations") or [])
        for n in rec.get("own_norms", []):
            # "2024 INSC 123" identifies exactly one Supreme Court judgment; trust it only from the citation field,
            # not from a citation that merely appears near the top of another court's judgment.
            if NEUTRAL_RE.fullmatch(n) and n in normalize_any_all(listed):
                r = c.execute("SELECT jid FROM cite_index WHERE norm=? LIMIT 1", (n,)).fetchone()
                if r:
                    return r["jid"]
        return None

    def mark_skipped(self, rid: str, reason: str) -> None:
        """Remember judgments that cannot be used (scanned PDF without text, duplicate) so re-runs skip them."""
        with closing(self.conn()) as c:
            c.execute("INSERT OR REPLACE INTO skipped(id, reason) VALUES(?,?)", (rid, reason))
            c.commit()

    def quality_report(self) -> dict:
        """How clean the real library is. Fixture (demo) judgments are excluded."""
        with closing(self.conn()) as c:
            q = lambda sql: c.execute(sql).fetchone()[0]  # noqa: E731
            real = "source!='fixture'"
            out = {
                "judgments": q(f"SELECT COUNT(*) FROM judgments WHERE {real}"),
                "missing_date": q(f"SELECT COUNT(*) FROM judgments WHERE {real} AND COALESCE(decision_date,'')=''"),
                "missing_citation": q(f"SELECT COUNT(*) FROM judgments WHERE {real} AND COALESCE(citations,'[]') IN ('[]','')"),
                "short": q(f"SELECT COUNT(*) FROM judgments WHERE {real} AND n_paras < 5"),
                "fallback_title": q(f"SELECT COUNT(*) FROM judgments WHERE {real} AND title NOT LIKE '% v. %' "
                                    "AND title NOT LIKE 'In re %'"),
                "duplicates_skipped": q("SELECT COUNT(*) FROM skipped WHERE reason='duplicate'"),
                "scanned_skipped": q("SELECT COUNT(*) FROM skipped WHERE reason='scanned_or_empty'"),
            }
        n = out["judgments"] or 1
        issues = out["missing_date"] + out["missing_citation"] + out["short"] + out["fallback_title"]
        out["clean_share"] = round(1 - min(1.0, issues / (4 * n)), 3) if out["judgments"] else None
        return out

    def resolve_parallel(self) -> int:
        """Map parallel citations to the judgment that one of them already identifies. Returns rows added."""
        added = 0
        with closing(self.conn()) as c:
            for _ in range(3):  # chains: A=B, B=C
                cur = c.execute(
                    "INSERT OR IGNORE INTO cite_index(norm, jid) "
                    "SELECT p.b, ci.jid FROM cite_pairs p JOIN cite_index ci ON ci.norm=p.a "
                    "WHERE p.b NOT IN (SELECT norm FROM cite_index) "
                    "UNION SELECT p.a, ci.jid FROM cite_pairs p JOIN cite_index ci ON ci.norm=p.b "
                    "WHERE p.a NOT IN (SELECT norm FROM cite_index)")
                if cur.rowcount <= 0:
                    break
                added += cur.rowcount
            c.commit()
        return added

    def reindex_citator(self, progress=None) -> int:
        """Recompute treatment and parallel citations from stored paragraphs (for libraries built earlier)."""
        from .citator import analyse

        with closing(self.conn()) as c:
            ids = [r["id"] for r in c.execute("SELECT id FROM judgments")]
            for i, jid in enumerate(ids, 1):
                paras = [{"no": r["no"], "text": r["text"]} for r in
                         c.execute("SELECT no, text FROM paras WHERE jid=? ORDER BY id", (jid,))]
                own = {r["norm"] for r in c.execute("SELECT norm FROM cite_index WHERE jid=?", (jid,))}
                refs, pairs = analyse(paras)
                c.execute("DELETE FROM cites WHERE src=?", (jid,))
                for r in refs:
                    if r["norm"] not in own:
                        c.execute("INSERT INTO cites(src,norm,para_no,treatment) VALUES(?,?,?,?)",
                                  (jid, r["norm"], r["para_no"], r["treatment"]))
                for a, b in pairs:
                    c.execute("INSERT OR IGNORE INTO cite_pairs(a,b,src) VALUES(?,?,?)", (a, b, jid))
                if i % 200 == 0:
                    c.commit()
                    if progress:
                        progress(f"citator: {i}/{len(ids)}")
            c.commit()
        self.resolve_parallel()
        return len(ids)

    def treatment_summary(self, jids) -> dict:
        """For each judgment: how judgments in the library treat it."""
        jids = list(set(jids))
        if not jids:
            return {}
        out = {j: {"negative": 0, "caution": 0, "positive": 0, "cited": 0} for j in jids}
        q = ",".join("?" * len(jids))
        with closing(self.conn()) as c:
            for r in c.execute(
                    f"SELECT ci.jid, COALESCE(x.treatment,'cited') t, COUNT(DISTINCT x.src) n FROM cite_index ci "
                    f"JOIN cites x ON x.norm=ci.norm WHERE ci.jid IN ({q}) AND x.src != ci.jid "
                    f"GROUP BY ci.jid, t", jids):
                out[r["jid"]][r["t"]] = r["n"]
        return out

    def purge_source(self, source: str) -> int:
        with closing(self.conn()) as c:
            ids = [r["id"] for r in c.execute("SELECT id FROM judgments WHERE source=?", (source,))]
            for jid in ids:
                self._remove(c, jid)
            c.commit()
            return len(ids)

    def existing_ids(self, prefix: str = "") -> set:
        """Ids to skip on the next run: stored judgments plus known duplicates and scanned PDFs."""
        with closing(self.conn()) as c:
            ids = {r["id"] for r in c.execute("SELECT id FROM judgments WHERE id LIKE ?", (prefix + "%",))}
            ids |= {r["id"] for r in c.execute("SELECT id FROM skipped WHERE id LIKE ?", (prefix + "%",))}
            return ids

    EDITABLE = ("title", "court", "decision_date", "citations", "bench", "disposal")

    def update_metadata(self, jid: str, fields: dict) -> dict:
        """Correct a judgment's details by hand. Returns {field: (old, new)} for what changed. The year follows the
        date, the title search index follows the title, and the citation lookup follows the citations."""
        bad = set(fields) - set(self.EDITABLE)
        if bad:
            raise ValueError(f"cannot edit: {', '.join(sorted(bad))}")
        with closing(self.conn()) as c:
            j = c.execute("SELECT * FROM judgments WHERE id=?", (jid,)).fetchone()
            if not j:
                raise KeyError(jid)
            changed, sets, args = {}, [], []
            for k, v in fields.items():
                if k == "citations":
                    v = [str(x).strip() for x in v if str(x).strip()]
                    old = json.loads(j["citations"] or "[]")
                    val = json.dumps(v)
                else:
                    v = str(v).strip()
                    old, val = j[k], v
                if k == "title" and not v:
                    raise ValueError("the title cannot be empty")
                if k == "decision_date" and v:
                    from .quality import _valid_date

                    d = _valid_date(v)
                    if not d:
                        raise ValueError("the date must look like 2019-04-30 and be a real date")
                if old != v:
                    changed[k] = (old, v)
                    sets.append(f"{k}=?")
                    args.append(val)
                    if k == "decision_date" and v:
                        sets.append("year=?")
                        args.append(int(v[:4]))
            if not changed:
                return {}
            c.execute(f"UPDATE judgments SET {', '.join(sets)} WHERE id=?", args + [jid])
            if "title" in changed:
                c.execute("DELETE FROM titles_fts WHERE jid=?", (jid,))
                c.execute("INSERT INTO titles_fts(jid,title) VALUES(?,?)", (jid, changed["title"][1]))
            if "citations" in changed:
                c.execute("DELETE FROM cite_index WHERE jid=?", (jid,))
                for cit in changed["citations"][1]:
                    for n in extract_norms(cit):
                        c.execute("INSERT OR IGNORE INTO cite_index(norm,jid) VALUES(?,?)", (n, jid))
            c.execute("DELETE FROM quality WHERE jid=?", (jid,))  # scored again on the next check
            c.commit()
        return changed

    def set_summary(self, jid: str, summary: str) -> None:
        with closing(self.conn()) as c:
            c.execute("UPDATE judgments SET summary=? WHERE id=?", (summary, jid))
            c.commit()

    # ------------------------------------------------------------ reading
    def stats(self) -> dict:
        with closing(self.conn()) as c:
            n = c.execute("SELECT COUNT(*) n FROM judgments").fetchone()["n"]
            real = c.execute("SELECT COUNT(*) n FROM judgments WHERE source!='fixture'").fetchone()["n"]
            paras = c.execute("SELECT COUNT(*) n FROM paras").fetchone()["n"]
            yrs = c.execute("SELECT MIN(year) a, MAX(year) b FROM judgments WHERE source!='fixture'").fetchone()
            courts = [{"court": r["court"], "count": r["n"]} for r in c.execute(
                "SELECT court, COUNT(*) n FROM judgments WHERE source!='fixture' GROUP BY court ORDER BY n DESC")]
        return {"judgments": n, "real_judgments": real, "paragraphs": paras, "fixture_only": real == 0,
                "year_min": yrs["a"], "year_max": yrs["b"], "courts": courts}

    def _where(self, court, year_from, year_to, jid, act=None, section=None):
        sql, args = "", []
        if act:
            sql += " AND p.jid IN (SELECT jid FROM section_refs WHERE act = ?"
            args.append(act)
            if section:
                sql += " AND section = ?"
                args.append(acts.clean_no(section))
            sql += ")"
        if court:
            sql += " AND j.court = ?"; args.append(court)
        if year_from:
            sql += " AND j.year >= ?"; args.append(int(year_from))
        if year_to:
            sql += " AND j.year <= ?"; args.append(int(year_to))
        if jid:
            sql += " AND p.jid = ?"; args.append(jid)
        return sql, args

    def search_paras(self, q: str, *, mode: str = "and", court=None, year_from=None, year_to=None, jid=None,
                     limit: int = 300, snippet: bool = False, with_id: bool = False, act=None, section=None) -> list:
        fq = fts_query(q, mode)
        if not fq:
            return []
        extra, args = self._where(court, year_from, year_to, jid, act, section)
        snip = ", snippet(paras_fts, 0, '<mark>', '</mark>', ' ... ', 32) AS snip" if snippet else ""
        sql = (f"SELECT p.id AS pid, p.jid, p.no, p.text, bm25(paras_fts) AS score, j.title, j.court, j.decision_date, j.year, "
               f"j.citations{snip} FROM paras_fts JOIN paras p ON p.id = paras_fts.rowid "
               f"JOIN judgments j ON j.id = p.jid WHERE paras_fts MATCH ?{extra} ORDER BY score LIMIT ?")
        with closing(self.conn()) as c:
            return [dict(r) for r in c.execute(sql, [fq] + args + [limit]).fetchall()]

    def paras_by_ids(self, ids: list) -> list:
        if not ids:
            return []
        q = ",".join("?" * len(ids))
        with closing(self.conn()) as c:
            rows = {r["pid"]: dict(r) for r in c.execute(
                f"SELECT p.id pid, p.jid, p.no, p.text, j.title, j.court, j.decision_date, j.year, j.citations "
                f"FROM paras p JOIN judgments j ON j.id=p.jid WHERE p.id IN ({q})", ids)}
        return [rows[i] for i in ids if i in rows]

    def hybrid(self, q: str, *, court=None, year_from=None, year_to=None, jid=None, limit: int = 120,
               act=None, section=None) -> tuple:
        """Keyword (BM25, with synonyms) + semantic ranking fused by reciprocal rank. Returns (rows, mode)."""
        from . import vectors

        kw, mode = [], "and"
        for mode in ("and", "or"):
            kw = self.search_paras(q, mode=mode, court=court, year_from=year_from, year_to=year_to, jid=jid,
                                   limit=limit, snippet=True, with_id=True, act=act, section=section)
            if kw:
                break
        sem = vectors.search(self, q, k=400)
        if not sem:
            return kw, mode
        meta = {r["pid"]: r for r in self.paras_by_ids([pid for pid, _ in sem])}
        allowed = self.jids_with_section(act, section) if act else None
        sem_rows = []
        for pid, score in sem:
            r = meta.get(pid)
            if not r or (court and r["court"] != court) or (jid and r["jid"] != jid):
                continue
            if allowed is not None and r["jid"] not in allowed:
                continue
            if (year_from and (r["year"] or 0) < int(year_from)) or (year_to and (r["year"] or 9999) > int(year_to)):
                continue
            if score < 0.35:
                break
            sem_rows.append(r)
        fused: dict = {}
        for rank, r in enumerate(kw):
            fused.setdefault(r["pid"], {"row": r, "s": 0.0})["s"] += 1.0 / (60 + rank)
        for rank, r in enumerate(sem_rows):
            e = fused.setdefault(r["pid"], {"row": dict(r, snip=highlight(r["text"], q)), "s": 0.0})
            e["s"] += 1.0 / (60 + rank)
        rows = [e["row"] for e in sorted(fused.values(), key=lambda e: -e["s"])][:limit]
        return rows, ("hybrid" if kw else "semantic")

    def search(self, q: str, *, court=None, year_from=None, year_to=None, limit: int = 10, offset: int = 0,
               act=None, section=None) -> dict:
        """Judgment-level results with the best matching paragraphs as snippets."""
        rows, used = self.hybrid(q, court=court, year_from=year_from, year_to=year_to, limit=300, act=act, section=section)
        grouped: dict = {}
        for r in rows:
            g = grouped.setdefault(r["jid"], {"id": r["jid"], "title": r["title"], "court": r["court"],
                                              "decision_date": r["decision_date"], "year": r["year"],
                                              "citation": _first_cite(r["citations"]), "hits": []})
            if len(g["hits"]) < 2:
                g["hits"].append({"no": r["no"], "snippet": r.get("snip") or highlight(r["text"], q)})
        results = list(grouped.values())
        page = results[offset:offset + limit]
        tr = self.treatment_summary([x["id"] for x in page])
        for x in page:
            x["treatment"] = tr.get(x["id"], {})
        return {"query": q, "match": used, "total": len(results), "offset": offset, "results": page}

    def get_judgment(self, jid: str) -> Optional[dict]:
        with closing(self.conn()) as c:
            j = c.execute("SELECT * FROM judgments WHERE id=?", (jid,)).fetchone()
            if not j:
                return None
            paras = [{"no": r["no"], "text": r["text"]} for r in
                     c.execute("SELECT no, text FROM paras WHERE jid=? ORDER BY id", (jid,))]
        d = dict(j)
        d["citations"] = json.loads(d["citations"] or "[]")
        d["paragraphs"] = paras
        return d

    def by_citation(self, norm: str) -> Optional[str]:
        with closing(self.conn()) as c:
            r = c.execute("SELECT jid FROM cite_index WHERE norm=?", (norm,)).fetchone()
            return r["jid"] if r else None

    def title_candidates(self, name: str, k: int = 8) -> list:
        toks = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if t not in NAME_STOP and len(t) > 1]
        if not toks:
            return []
        fq = " OR ".join(f'"{t}"' for t in sorted(set(toks)))
        with closing(self.conn()) as c:
            return [dict(r) for r in c.execute(
                "SELECT j.id, j.title FROM titles_fts f JOIN judgments j ON j.id=f.jid "
                "WHERE titles_fts MATCH ? ORDER BY bm25(titles_fts) LIMIT ?", (fq, k))]

    def links(self, jid: str) -> dict:
        """cites: judgments this one relies on (in the library). cited_by: judgments in the library citing it,
        with how they treat it and in which paragraph."""
        from .citator import RANK

        with closing(self.conn()) as c:
            cites = [dict(r) for r in c.execute(
                "SELECT DISTINCT j.id, j.title, j.court, j.year FROM cites x JOIN cite_index ci ON ci.norm=x.norm "
                "JOIN judgments j ON j.id=ci.jid WHERE x.src=? AND ci.jid!=? ORDER BY j.year DESC", (jid, jid))]
            rows = c.execute(
                "SELECT j.id, j.title, j.court, j.year, x.para_no, COALESCE(x.treatment,'cited') t FROM cite_index ci "
                "JOIN cites x ON x.norm=ci.norm JOIN judgments j ON j.id=x.src WHERE ci.jid=? AND x.src!=? "
                "ORDER BY j.year DESC", (jid, jid)).fetchall()
            total = c.execute("SELECT COUNT(DISTINCT norm) n FROM cites WHERE src=?", (jid,)).fetchone()["n"]
        by: dict = {}
        for r in rows:
            g = by.setdefault(r["id"], {"id": r["id"], "title": r["title"], "court": r["court"], "year": r["year"],
                                        "treatment": "cited", "paras": []})
            if RANK[r["t"]] > RANK[g["treatment"]]:
                g["treatment"] = r["t"]
            if r["para_no"] is not None and r["para_no"] not in g["paras"]:
                g["paras"].append(r["para_no"])
        cited_by = sorted(by.values(), key=lambda g: (-RANK[g["treatment"]], -(g["year"] or 0)))[:200]
        counts = {k: sum(1 for g in by.values() if g["treatment"] == k) for k in RANK}
        return {"cites": cites, "cited_by": cited_by, "treatment": counts, "citations_in_text": total,
                "not_in_corpus": max(0, total - len(cites))}


class StoreIndex:
    """Adapter so the citation checker can use the store (same interface as JudgmentIndex)."""

    def __init__(self, store: Store):
        self.store = store

    @property
    def judgments(self):
        return range(self.store.stats()["judgments"])

    def _load(self, jid: str) -> Judgment:
        d = self.store.get_judgment(jid)
        return Judgment(id=d["id"], title=d["title"], court=d["court"], date=d["decision_date"],
                        citations=d["citations"], paragraphs=d["paragraphs"], source=d["source"])

    def resolve(self, cit):
        jid = self.store.by_citation(cit.normalized)
        if jid:
            return self._load(jid), "citation"
        if cit.case_name:
            for cand in self.store.title_candidates(cit.case_name):
                if name_match(cit.case_name, cand["title"]) >= 0.7:
                    return self._load(cand["id"]), "name_only"
        return None, "none"


# ------------------------------------------------------------ singleton + demo data

_store: Optional[Store] = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = Store(CORPUS_DB)
    return _store


def set_store(store: Optional[Store]) -> None:
    global _store
    _store = store


def seed_demo(store: Store) -> int:
    """Load the three FICTIONAL test judgments so the app is not empty before the real corpus is ingested."""
    path = DATA_DIR / "fixtures" / "sample_judgments.json"
    n = 0
    for j in json.loads(path.read_text(encoding="utf-8"))["judgments"]:
        norms = sorted({normalize_any(c) for c in j["citations"]})
        text = " ".join(p["text"] for p in j["paragraphs"])
        ok = store.add_judgment({
            "id": "fx-" + j["id"].split("-")[-1], "title": j["title"], "court": j["court"],
            "decision_date": j["date"], "year": int(j["date"][:4]), "citations": j["citations"], "bench": "",
            "disposal": "", "source": "fixture", "source_url": "", "paragraphs": j["paragraphs"],
            "own_norms": norms, "cite_norms": sorted(extract_norms(text))})
        n += int(ok)
    return n
