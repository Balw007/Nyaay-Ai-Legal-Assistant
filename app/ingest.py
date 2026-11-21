"""Fill the judgment database.

  python -m app.ingest sc --years 2024                 # Supreme Court judgments (open dataset, CC-BY-4.0)
  python -m app.ingest sc --from-year 2020 --to-year 2024 --limit 300
  python -m app.ingest sc --years 2024 --probe         # check access and show what the data looks like
  python -m app.ingest hc --courts 27_1 --years 2024 --limit 200   # High Courts (27_1 = Bombay HC)
  python -m app.ingest hc --list-courts                 # show available court codes
  python -m app.ingest files C:\\path\\to\\folder        # your own PDFs / text files
  python -m app.ingest reindex                           # rebuild citator + parallel citations
  python -m app.ingest embed                             # semantic search vectors (pip install fastembed)
  python -m app.ingest stats

Source: https://registry.opendata.aws/indian-supreme-court-judgments/ (public, no account needed).
Be considerate: keep --workers low. Safe to stop and re-run; judgments already stored are skipped.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import quote

from .services import ocr as ocr_mod
from .services.citations import extract_norms
from .services.citator import analyse
from .services.store import Store, get_store

S3_SC = "https://indian-supreme-court-judgments.s3.ap-south-1.amazonaws.com"
UA = "nyaay-ingest/0.1 (legal research; low concurrency)"
MIN_TEXT = 800  # fewer characters than this means a scanned or empty PDF


class FetchError(RuntimeError):
    pass


def http_get(url: str, timeout: int = 90, retries: int = 3) -> bytes:
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                raise FetchError(f"HTTP {exc.code} for {url}")
            last = exc
        except Exception as exc:  # network hiccup: retry
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise FetchError(f"{type(last).__name__}: {last} for {url}")


# ------------------------------------------------------------ listing

def _list_via_s3(base: str, prefix: str, fetch: Callable[[str], bytes]) -> list:
    names, token = [], None
    while True:
        url = f"{base}/?list-type=2&prefix={quote(prefix)}&max-keys=1000"
        if token:
            url += f"&continuation-token={quote(token)}"
        root = ET.fromstring(fetch(url))
        keys = [e.text for e in root.iter() if e.tag.endswith("}Key") or e.tag == "Key"]
        names += [k[len(prefix):] for k in keys if k.lower().endswith(".pdf")]
        trunc = next((e.text for e in root.iter() if e.tag.endswith("IsTruncated")), "false")
        nxt = next((e.text for e in root.iter() if e.tag.endswith("NextContinuationToken")), None)
        if trunc != "true" or not nxt:
            return names
        token = nxt


def list_year(base: str, year: int, fetch: Callable[[str], bytes]) -> list:
    """English judgment PDF file names for a year. Uses the dataset's index file, falls back to listing the bucket."""
    try:
        idx = json.loads(fetch(f"{base}/data/tar/year={year}/english/english.index.json"))
        names = []
        for part in idx.get("parts", []):
            names += part.get("files", [])
        names += idx.get("files", [])
        names = [n for n in names if str(n).lower().endswith(".pdf")]
        if names:
            return sorted(set(names))
    except Exception:
        pass
    return sorted(set(_list_via_s3(base, f"data/pdf/year={year}/english/", fetch)))


# ------------------------------------------------------------ text handling

def pdf_to_text(data: bytes) -> str:
    """Text of every page, pages separated by a form feed so cleaning can find running headers and footers."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\x0c".join((page.extract_text() or "") for page in reader.pages)


def pdf_to_text_ocr(data: bytes, enabled: bool = True) -> str:
    """Text layer first; when a judgment is a scan, read it with OCR if an engine is installed."""
    text = pdf_to_text(data)
    if enabled and len(text.replace("\x0c", "").strip()) < MIN_TEXT:
        scanned = ocr_mod.ocr_pdf_for_ingest(data)
        if scanned:
            return scanned
    return text


# OCR of the big open-data downloads is slow on a laptop (minutes per scanned judgment), so it is opt-in there.
# Files you upload yourself are always read with OCR when an engine is installed.
OCR_BULK = os.getenv("NYAAY_OCR_BULK", "0") == "1"


# ------------------------------------------------------------ cleaning
# pypdf output of Indian court judgments carries layout debris: e-signature stamps, page numbers, running
# headers (case title, neutral citation), "REPORTABLE" marks, ligatures and broken lines. Clean text matters:
# it is what search, the citator and the AI read, and what an advocate copies into a brief.

LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl", "\ufb05": "st", "\ufb06": "st"}
CHAR_MAP = str.maketrans({
    **LIGATURES,
    "\u00ad": "", "\u200b": "", "\u2060": "", "\ufeff": "",          # soft hyphen, zero-width space, BOM
    "\u00a0": " ", "\u2002": " ", "\u2003": " ", "\u2009": " ", "\u202f": " ", "\u2007": " ", "\u3000": " ",
    "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"', "\u2033": '"',
    "\u2010": "-", "\u2011": "-", "\u2212": "-", "\u2026": "...", "\t": " ",
})
# ZWJ/ZWNJ (\u200c, \u200d) are kept: they change how Devanagari conjuncts render.

MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_SIG_START = re.compile(r"^\s*(?:signature\s+not\s+verified|digitally\s+signed\s+by\b)", re.I)
_SIG_LINE = re.compile(
    r"^\s*(?:signature\s+not\s+verified|signature\s+verified|digitally\s+signed\s+by\b.*|"
    r"date\s*:?\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}.*|\d{1,2}:\d{2}(?::\d{2})?\s*(?:ist|[+-]\d{2}'?\d{2}'?)?|"
    r"reason\s*:.*|location\s*:.*)\s*$", re.I)
_PAGE_NO = re.compile(r"^\s*(?:page\s*(?:no\.?\s*)?\d{1,4}(?:\s*(?:of|/)\s*\d{1,4})?|\d{1,4}\s*(?:of|/)\s*\d{1,4}|"
                      r"-\s*\d{1,4}\s*-|\[\s*\d{1,4}\s*\]|\(\s*\d{1,4}\s*\)|\d{1,4})\s*$", re.I)
_MARKS = re.compile(r"^\s*(?:non[\s-]*reportable|reportable|not\s+reportable|\*+|_+|-{3,}|\.{3,})\s*\.?\s*$", re.I)
_NEUTRAL = re.compile(r"^\s*\d{4}\s+INSC\s+\d+\s*$", re.I)
_BARE_PARA_NO = re.compile(r"^\s*(\d{1,3})\s*[.)]\s*$")


def normalize_chars(text: str) -> str:
    text = unicodedata.normalize("NFC", text.translate(CHAR_MAP))
    return re.sub(r"[\x00-\x08\x0b\x0e-\x1f\x7f]", "", text)


def _shape(line: str) -> str:
    """A line with its numbers blanked, so 'Page 3' and 'Page 4' count as the same running footer."""
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", line.strip().lower()))


def _strip_signatures(lines: list) -> list:
    """Drop e-signature stamps: 'Signature Not Verified / Digitally signed by NAME / Date: 2024.01.02 17:45:12 IST /
    Reason: / Location:'. The signer's name may sit on its own line right after 'Digitally signed by'."""
    out, i = [], 0
    while i < len(lines):
        st = lines[i].strip()
        if _SIG_START.match(st):
            j = i + 1
            while j < len(lines) and j <= i + 7:
                nxt = lines[j].strip()
                if not nxt or _SIG_LINE.match(nxt):
                    j += 1
                    continue
                if re.match(r"^\s*digitally\s+signed\s+by\s*$", lines[j - 1], re.I) and len(nxt) <= 40 and \
                        re.fullmatch(r"[A-Za-z .]+", nxt) and any(_SIG_LINE.match(x.strip()) for x in lines[j + 1:j + 3]):
                    j += 1  # signer's name
                    continue
                break
            i = j
            continue
        if re.match(r"^\s*date\s*:?\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s+\d{1,2}:\d{2}", st, re.I) or \
                re.match(r"^\s*signature\s+(?:not\s+)?verified\s*$", st, re.I):
            i += 1
            continue
        out.append(lines[i])
        i += 1
    return out


def clean_text(text: str) -> str:
    text = normalize_chars(text)
    pages = [p.split("\n") for p in text.split("\x0c")]
    # Running headers/footers: short lines in the top or bottom 3 lines of a page that recur on 3+ pages.
    edge_counts: dict = {}
    if len(pages) >= 3:
        for lines in pages:
            body = [ln for ln in lines if ln.strip()]
            seen = set()
            for ln in body[:3] + body[-3:]:
                sh = _shape(ln)
                if 0 < len(sh) <= 90 and sh not in seen:
                    seen.add(sh)
                    edge_counts[sh] = edge_counts.get(sh, 0) + 1
    # On short judgments a header repeats on every page after the first (2 of 3 pages); longer ones need 3+.
    need = 2 if len(pages) <= 4 else max(3, int(0.4 * len(pages)))
    repeated = {sh for sh, n in edge_counts.items() if n >= need}
    kept_pages = []
    for pno, lines in enumerate(pages):
        lines = _strip_signatures(lines)
        body = [i for i, ln in enumerate(lines) if ln.strip()]
        edges = set(body[:3] + body[-3:])
        out = []
        for i, ln in enumerate(lines):
            st = ln.strip()
            if not st:
                out.append("")
                continue
            if i in edges and _shape(st) in repeated and not (pno == 0 and _NEUTRAL.match(st)):
                continue  # running header/footer (the neutral citation is kept where it first appears)
            if _PAGE_NO.match(st) or _MARKS.match(st):
                continue
            if pno > 0 and i in edges and _NEUTRAL.match(st):
                continue
            out.append(st)
        kept_pages.append(out)
    lines = [ln for page in kept_pages for ln in page + [""]]
    # A paragraph number alone on its line ("12.") belongs to the text below it.
    merged, i = [], 0
    while i < len(lines):
        m = _BARE_PARA_NO.match(lines[i])
        if m:
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                merged.append(f"{m.group(1)}. {lines[j].strip()}")
                i = j + 1
                continue
        merged.append(lines[i])
        i += 1
    text = "\n".join(merged)
    text = re.sub(r"(?<=[a-z])-\n(?=[a-z])", "", text)            # hyphenated line breaks: "consi-\nderation"
    text = re.sub(r"[ ]{2,}", " ", text)
    text = re.sub(r" +\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


PARA_START = re.compile(r"^\s*(\d{1,3})\s*[.)]\s+(\S)")
# A number at the start of a line that continues a reference ("... under Section\n138. ...") is not a paragraph.
_REF_WORDS = re.compile(
    r"(?:\b(?:section|sections|para|paras|paragraph|paragraphs|rule|rules|article|articles|clause|clauses|order|"
    r"item|entry|schedule|regulation|chapter|page|pages|form|volume|sub-section|sub-rule|rs|no|nos)\s*$"  # word, no stop
    r"|\b(?:s|ss|sec|secs|art|arts|cl|r|no|nos|p|pp|vol|rs)\.\s*$)", re.I)                    # abbreviation.


def _is_para_start(line: str, prev: str, last: int) -> bool:
    m = PARA_START.match(line)
    if not m or int(m.group(1)) != last + 1:
        return False
    if prev and _REF_WORDS.search(prev.strip()):
        return False
    # "1.5 lakh" or "2.30 pm" never reach here (no space after the dot); "5. lakh" style money is guarded below
    if re.match(r"^\s*\d{1,3}\s*[.)]\s+(?:lakh|lakhs|crore|crores|per\s+cent|%|pm|am|p\.m|a\.m)\b", line, re.I):
        return False
    return True


def split_paragraphs(text: str) -> list:
    """Numbered paragraphs (1., 2., ...) as courts write them; sub-paragraphs (a), (i) stay inside their parent.
    Falls back to ~900-character chunks for judgments without numbered paragraphs."""
    paras, cur, last = [], [], 0
    pre: list = []
    prev = ""
    for line in text.split("\n"):
        if _is_para_start(line, prev, last):
            if cur:
                paras.append((last, " ".join(cur)))
            last, cur = last + 1, [line.strip()]
        elif last == 0:
            pre.append(line.strip())
        else:
            cur.append(line.strip())
        if line.strip():
            prev = line
    if cur:
        paras.append((last, " ".join(cur)))
    if len(paras) >= 3:
        out = [{"no": n, "text": re.sub(r"\s+", " ", t).strip()} for n, t in paras]
        head = re.sub(r"\s+", " ", " ".join(x for x in pre if x)).strip()
        return ([{"no": 0, "text": head[:1500]}] if head else []) + [p for p in out if p["text"]]
    flat = re.sub(r"\s+", " ", text).strip()
    chunks, i, n = [], 0, 1
    while i < len(flat):
        j = min(len(flat), i + 900)
        if j < len(flat):
            cut = flat.rfind(". ", i + 400, j)
            j = cut + 1 if cut != -1 else j
        chunks.append({"no": n, "text": flat[i:j].strip()})
        i, n = j, n + 1
    return chunks


# ------------------------------------------------------------ titles
_VS = r"(?:versus|vs\.?|v/s\.?|v\.)"
TITLE_RE = re.compile(r"([A-Z][A-Za-z0-9.,&'()/\- ]{2,140}?)\s+" + _VS + r"\s+([A-Z][A-Za-z0-9.,&'()/\- ]{2,140})", re.I)
_HEADER_BITS = re.compile(
    r"(?:in\s+the\s+supreme\s+court\s+of\s+india|"
    r"in\s+the\s+high\s+court\s+(?:of\s+(?:judicature\s+)?(?:for\s+)?(?:at\s+)?[a-z]+(?:\s+and\s+[a-z]+)?|at\s+[a-z]+)"
    r"(?:\s+at\s+(?:new\s+delhi|[a-z]+))?(?:\s+(?:bench\s+at\s+[a-z]+|[a-z]+\s+bench))?|"
    r"(?:civil|criminal|original|appellate|writ|extraordinary|special)\s+(?:appellate\s+|original\s+)?jurisdiction|"
    r"(?:(?:civil|criminal|crl\.?|special\s+leave|writ|transfer|review|curative|arbitration|bail|first|second)\s+)?"
    r"(?:appeal|petition|application|case|suit|reference)\s*(?:\(\s*[a-z.]+\s*\)\s*)?(?:no|nos)\.?\s*[\w./\- ]*?(?:of|/)\s*\d{4}|"
    r"\(\s*arising\s+out\s+of.*?\d{4}\s*\)|\b(?:non[\s-]*)?reportable\b|"
    r"\b\d{4}\s+insc\s+\d+\b|\(\d{4}\)\s*\d+\s*scc\s*\d+|\bair\s+\d{4}\s+sc\s+\d+)", re.I)
_ROLES = re.compile(r"\s\.{2,}\s*|\.{3,}\s*|\b(?:appellants?|respondents?|petitioners?|applicants?|complainants?|accused|"
                    r"plaintiffs?|defendants?|opp(?:osite|\.)\s*part(?:y|ies)|non-applicants?)\s*(?:\(s\)|nos?\.?\s*[\d,\s&]+)?"
                    r"(?=\W|$)", re.I)
_TITLE_END = re.compile(r"\s(?:j\s*u\s*d\s*g\s*m\s*e\s*n\s*t|o\s*r\s*d\s*e\s*r|judgment|order|coram|present|"
                        r"date of|dated|reserved on|pronounced on|with)\b.*$", re.I)
ACRONYMS = {"UOI", "CBI", "ED", "NCT", "SBI", "HDFC", "ICICI", "IDBI", "LIC", "BSNL", "MTNL", "ONGC", "NTPC", "RBI",
            "SEBI", "DDA", "MCD", "BMC", "MSEDCL", "MHADA", "CIDCO", "UP", "MP", "HP", "J&K", "NHAI", "GST", "IT",
            "LLP", "HUF", "KSRTC", "MSRTC", "BEST", "IDFC", "IOB", "PNB", "UCO", "BOB", "NOIDA", "DLF", "ITC", "TATA",
            "NDPS", "POCSO", "CIT", "ACIT", "DCIT", "ITO", "CCI", "TRAI", "SFIO", "NIA", "DRT", "NCLT", "NCLAT"}
WORD_CASE = {"LTD": "Ltd", "LTD.": "Ltd.", "PVT": "Pvt", "PVT.": "Pvt.", "M/S": "M/s", "M/S.": "M/s.", "ORS": "Ors",
             "ORS.": "Ors.", "ANR": "Anr", "ANR.": "Anr.", "CO": "Co", "CO.": "Co.", "INC": "Inc", "INC.": "Inc.",
             "SMT": "Smt", "SMT.": "Smt.", "SHRI": "Shri", "SHRI.": "Shri.", "DR.": "Dr.", "MR.": "Mr.", "MRS.": "Mrs.",
             "KUMARI": "Kumari"}
SMALL = {"of", "and", "the", "for", "in", "on", "at", "by", "to", "through", "thr", "thr.", "&"}


def _case_word(w: str, first: bool) -> str:
    up = w.upper()
    core = up.strip("(),")
    if core in WORD_CASE:
        return w.upper().replace(core, WORD_CASE[core])
    if core.rstrip(".") in ACRONYMS or re.fullmatch(r"(?:[A-Z]\.){2,}", core):  # UOI, M.P., A.K.
        return up
    lw = w.lower()
    if not first and lw.strip("(),") in SMALL:
        return lw
    return "-".join(p[:1].upper() + p[1:] for p in lw.split("-"))


_EMPTY_BRACKETS = re.compile(r"\(\s*\)|\[\s*\]")
_DATE_TAIL = re.compile(r"\s\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b.*$|"
                        r"\s\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.*$|\s(?:19|20)\d{2}\s*$", re.I)
_ET_AL = re.compile(r"\b(?:and\s+|&\s*)?(?:another|anr|others?|ors)\b\.?", re.I)


def _trim_party(part: str) -> str:
    """Cut a party name where the real title stops: empty brackets, a date, or after 'and Another / Ors'."""
    part = _EMPTY_BRACKETS.split(part, maxsplit=1)[0]
    part = _DATE_TAIL.sub("", part)
    m = _ET_AL.search(part)
    if m:
        part = part[:m.end()]
    return part


def tidy_title(t: str) -> str:
    """'ABC LTD. ...APPELLANT(S) VERSUS STATE OF MAHARASHTRA ...RESPONDENT(S)' -> 'ABC Ltd. v. State of Maharashtra'."""
    t = re.sub(r"\s+", " ", normalize_chars(t or "")).strip()
    if not t:
        return ""
    m = re.search(r"\s" + _VS + r"\s", t, re.I)
    parts = [t[:m.start()], _TITLE_END.sub("", " " + t[m.end():])] if m else [_TITLE_END.sub("", " " + t)]
    clean = []
    for part in parts:
        part = _trim_party(part)
        part = _HEADER_BITS.sub(" ", part)
        part = _ROLES.sub(" ", part)
        part = re.sub(r"\s+", " ", part).strip(" ,;:-")
        part = re.sub(r"^[.\s]+", "", part)
        part = re.sub(r"^(?:with|and)\s+", "", part, flags=re.I)
        last = part.rsplit(" ", 1)[-1]
        if part.endswith(".") and not (last.upper() in WORD_CASE or "." in last[:-1] or len(last) <= 4):
            part = part[:-1]  # a sentence stop, not an abbreviation like Ltd. or U.P.
        part = re.sub(r"\s*(?:\band\b|&)\s*(ors?|anr|others?|another)\b\.?",
                      lambda x: " & " + ("Anr." if x.group(1).lower() in ("anr", "another") else "Ors."), part, flags=re.I)
        clean.append(part.strip())
    clean = [c for c in clean if c]
    if not clean:
        return ""
    letters = re.sub(r"[^A-Za-z]", "", " ".join(clean))
    if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.7:
        clean = [" ".join(_case_word(w, i == 0) for i, w in enumerate(c.split())) for c in clean]
    out = " v. ".join(clean)
    out = re.sub(r"\s+([,.])", r"\1", out)
    return out[:250]


def guess_title(text: str, fallback: str) -> str:
    head = re.sub(r"\s+", " ", normalize_chars(text[:2500]))
    head = _HEADER_BITS.sub(" ", head)
    m = TITLE_RE.search(head)
    if m:
        t = tidy_title(f"{m.group(1)} versus {m.group(2)}")
        if " v. " in t:
            return t
    if re.search(r"\bin\s+re\b", head, re.I):
        m2 = re.search(r"\bin\s+re\s*:?\s*([A-Za-z0-9 .,&'()-]{3,80})", head, re.I)
        if m2:
            return "In re " + tidy_title(m2.group(1))
    first = next((ln.strip() for ln in text.split("\n") if len(ln.strip()) > 8 and not _HEADER_BITS.fullmatch(ln.strip())),
                 fallback)
    return first[:150]


def _pick(meta: dict, *keys: str) -> str:
    for k in keys:
        v = meta.get(k)
        if v not in (None, "", []):
            return str(v).strip()
    return ""


# ------------------------------------------------------------ dates
_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d %B %Y", "%d %b %Y", "%B %d, %Y", "%b %d, %Y",
                 "%B %d %Y", "%d %B, %Y")
_TEXT_DATES = [
    re.compile(r"\b(" + MONTHS + r")\s+(\d{1,2})\s*,?\s*(\d{4})\b", re.I),                  # MARCH 12, 2024
    re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:day\s+of\s+)?(" + MONTHS + r")\s*,?\s*(\d{4})\b", re.I),
    re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b"),
]


def _valid(d, year: int) -> bool:
    from datetime import date as _date

    return d <= _date.today() and abs(d.year - year) <= 1 and d.year >= 1947


def _try_formats(s: str):
    s = re.sub(r"\s+", " ", s.strip().rstrip("."))
    for fmt in _DATE_FORMATS:
        for cand in (s, s[:10], s.split("T")[0]):
            try:
                return datetime.strptime(cand, fmt).date()
            except ValueError:
                continue
    return None


def date_from_text(text: str, year: int):
    """The decision date as judgments print it: 'NEW DELHI; MARCH 12, 2024' at the end, or 'Dated: 12.03.2024'."""
    tail, head = text[-2500:], text[:2500]
    for zone in (tail, head):
        found = []
        for i, pat in enumerate(_TEXT_DATES):
            for m in pat.finditer(zone):
                g = m.groups()
                s = f"{g[0]} {g[1]}, {g[2]}" if i == 0 else f"{g[0]} {g[1]} {g[2]}" if i == 1 else f"{g[0]}.{g[1]}.{g[2]}"
                d = _try_formats(s)
                if d and _valid(d, year):
                    found.append((m.start(), d))
        if found:
            return (max if zone is tail else min)(found)[1]
    return None


def parse_date(s: str, year: int, text: str = "") -> str:
    """Validated decision date (ISO). Rejects future dates and dates more than a year away from the judgment's
    year; then looks in the judgment text; returns '' when the true date is unknown (the year column still
    drives filters)."""
    d = _try_formats(s or "")
    if d and _valid(d, year):
        return d.isoformat()
    d = date_from_text(text, year) if text else None
    return d.isoformat() if d else ""


def build_record(rec_id: str, year: int, text: str, meta: dict, source: str, source_url: str,
                 default_court: str = "Supreme Court of India") -> Optional[dict]:
    text = clean_text(text)
    if len(text) < MIN_TEXT:
        return None
    paras = split_paragraphs(text)
    if not paras:
        return None
    meta_cites = " ; ".join(filter(None, [_pick(meta, "citation"), _pick(meta, "nc_display")]))
    own = extract_norms(meta_cites) | extract_norms(text[:500])
    title = tidy_title(_pick(meta, "title", "case_title")) or guess_title(text, rec_id)
    cites_raw = [c for c in re.split(r"\s*;\s*", meta_cites) if c] or sorted(own)
    refs, pairs = analyse(paras)
    return {
        "cite_refs": [r for r in refs if r["norm"] not in own], "cite_pairs": pairs,
        "id": rec_id, "title": title[:300], "court": _pick(meta, "court") or default_court,
        "decision_date": parse_date(_pick(meta, "decision_date", "date_of_decision"), year, text), "year": year,
        "citations": cites_raw, "bench": _pick(meta, "judge", "author_judge"),
        "disposal": _pick(meta, "disposal_nature"), "source": source, "source_url": source_url,
        "paragraphs": paras, "own_norms": sorted(own), "cite_norms": sorted(extract_norms(text) - own),
    }


# ------------------------------------------------------------ pipelines

def ingest_year(store: Store, year: int, *, base: str = S3_SC, fetch: Callable[[str], bytes] = http_get,
                limit: Optional[int] = None, workers: int = 4, progress: Callable[[str], None] = print) -> dict:
    stats = {"year": year, "added": 0, "skipped_existing": 0, "scanned_or_empty": 0, "failed": 0}
    names = list_year(base, year, fetch)
    progress(f"[{year}] {len(names)} English judgments listed")
    done = store.existing_ids(f"sc-{year}-")
    todo = []
    for n in names:
        stem = n[:-4]
        if f"sc-{year}-{stem}" in done:
            stats["skipped_existing"] += 1
        else:
            todo.append(n)
    if limit is not None:
        todo = todo[:limit]
    errors = []

    def work(name: str):
        stem = name[:-4]
        pdf_url = f"{base}/data/pdf/year={year}/english/{quote(name)}"
        text = pdf_to_text_ocr(fetch(pdf_url), OCR_BULK)
        try:
            meta = json.loads(fetch(f"{base}/metadata/json/year={year}/{quote(stem)}.json"))
            if not isinstance(meta, dict):
                meta = {}
        except Exception:
            meta = {}
        return build_record(f"sc-{year}-{stem}", year, text, meta, "sc-open-data", pdf_url)

    stats["duplicates"] = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for i, (name, fut) in enumerate([(n, pool.submit(work, n)) for n in todo], 1):
            try:
                rec = fut.result()
                if rec is None:
                    stats["scanned_or_empty"] += 1
                    store.mark_skipped(f"sc-{year}-{name[:-4]}", "scanned_or_empty")
                elif store.add_judgment(rec):
                    stats["added"] += 1
                elif store.last_skip == "duplicate":
                    stats["duplicates"] += 1
            except Exception as exc:
                stats["failed"] += 1
                errors.append(f"{name}: {type(exc).__name__}: {exc}")
            if i % 25 == 0 or i == len(todo):
                progress(f"[{year}] {i}/{len(todo)}  added={stats['added']} duplicates={stats['duplicates']} "
                         f"scanned={stats['scanned_or_empty']} failed={stats['failed']}")
    if errors:
        Path("ingest_errors.log").open("a", encoding="utf-8").write("\n".join(errors) + "\n")
    if stats["added"]:
        store.purge_source("fixture")  # real data is in; drop the fictional demo judgments
        stats["parallel_citations_mapped"] = store.resolve_parallel()
    return stats


# ------------------------------------------------------------ High Courts
S3_HC = "https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com"
HC_CODES_URL = "https://raw.githubusercontent.com/vanga/indian-high-court-judgments/main/court-codes.json"
HC_NAMES = {"27_1": "Bombay High Court"}  # the rest is read from the dataset's court-codes.json


def _s3_list(base: str, prefix: str, fetch: Callable[[str], bytes], delimiter: str = "") -> tuple:
    keys, prefixes, token = [], [], None
    while True:
        url = f"{base}/?list-type=2&prefix={quote(prefix)}&max-keys=1000"
        if delimiter:
            url += f"&delimiter={quote(delimiter)}"
        if token:
            url += f"&continuation-token={quote(token)}"
        root = ET.fromstring(fetch(url))
        for e in root.iter():
            tag = e.tag.split("}")[-1]
            if tag == "Key":
                keys.append(e.text)
            elif tag == "Prefix" and e.text and e.text != prefix:
                prefixes.append(e.text)
        nxt = next((e.text for e in root.iter() if e.tag.endswith("NextContinuationToken")), None)
        trunc = next((e.text for e in root.iter() if e.tag.endswith("IsTruncated")), "false")
        if trunc != "true" or not nxt:
            return keys, prefixes
        token = nxt


def hc_court_names(fetch: Callable[[str], bytes] = http_get) -> dict:
    names = dict(HC_NAMES)
    try:
        data = json.loads(fetch(HC_CODES_URL))
        items = data.items() if isinstance(data, dict) else [(d.get("code"), d.get("name")) for d in data]
        for code, name in items:
            if code and name:
                names[str(code).replace("~", "_")] = str(name)
    except Exception:
        pass
    return names


def ingest_hc(store: Store, year: int, court: str, *, base: str = S3_HC, fetch: Callable[[str], bytes] = http_get,
              limit: Optional[int] = None, workers: int = 4, progress: Callable[[str], None] = print,
              names: Optional[dict] = None) -> dict:
    """One High Court, one year. Discovers benches from the bucket, reads each judgment's metadata JSON and PDF."""
    names = names or HC_NAMES
    cname = names.get(court, f"High Court {court}")
    stats = {"year": year, "court": cname, "added": 0, "skipped_existing": 0, "scanned_or_empty": 0, "failed": 0}
    meta_prefix = f"metadata/json/year={year}/court={court}/"
    keys, _ = _s3_list(base, meta_prefix, fetch)
    keys = [k for k in keys if k.endswith(".json")]
    progress(f"[{cname} {year}] {len(keys)} judgments listed")
    done = store.existing_ids(f"hc-{court}-{year}-")
    todo = []
    for k in keys:
        rid = f"hc-{court}-{year}-" + k[len(meta_prefix):-5].replace("/", "-")[:120]
        if rid in done:
            stats["skipped_existing"] += 1
        else:
            todo.append((rid, k))
    if limit is not None:
        todo = todo[:limit]
    errors = []

    def work(item):
        rid, key = item
        meta = json.loads(fetch(f"{base}/{quote(key)}"))
        if not isinstance(meta, dict):
            meta = {}
        if meta.get("pdf_exists") is False:
            return None
        pdf_key = "data/pdf/" + key[len("metadata/json/"):-5] + ".pdf"
        text = pdf_to_text_ocr(fetch(f"{base}/{quote(pdf_key)}"), OCR_BULK)
        meta.setdefault("court", cname)
        return build_record(rid, year, text, meta, "hc-open-data", f"{base}/{quote(pdf_key)}", default_court=cname)

    stats["duplicates"] = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for i, (item, fut) in enumerate([(t, pool.submit(work, t)) for t in todo], 1):
            try:
                rec = fut.result()
                if rec is None:
                    stats["scanned_or_empty"] += 1
                    store.mark_skipped(item[0], "scanned_or_empty")
                elif store.add_judgment(rec):
                    stats["added"] += 1
                elif store.last_skip == "duplicate":
                    stats["duplicates"] += 1
            except Exception as exc:
                stats["failed"] += 1
                errors.append(f"{item[1]}: {type(exc).__name__}: {exc}")
            if i % 25 == 0 or i == len(todo):
                progress(f"[{cname} {year}] {i}/{len(todo)} added={stats['added']} failed={stats['failed']}")
    if errors:
        Path("ingest_errors.log").open("a", encoding="utf-8").write("\n".join(errors) + "\n")
    if stats["added"]:
        store.purge_source("fixture")
        stats["parallel_citations_mapped"] = store.resolve_parallel()
    return stats


def hc_list_courts(year: int, base: str = S3_HC, fetch: Callable[[str], bytes] = http_get) -> list:
    _, prefixes = _s3_list(base, f"metadata/json/year={year}/", fetch, delimiter="/")
    return [p.rstrip("/").split("court=")[-1] for p in prefixes if "court=" in p]


def ingest_files(store: Store, folder: str, progress: Callable[[str], None] = print) -> dict:
    stats = {"added": 0, "skipped_existing": 0, "scanned_or_empty": 0, "failed": 0}
    for p in sorted(Path(folder).rglob("*")):
        if p.suffix.lower() not in {".pdf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff"} or not p.is_file():
            continue
        try:
            data = p.read_bytes()
            rec_id = "local-" + hashlib.sha1(p.name.encode() + str(len(data)).encode()).hexdigest()[:12]
            suffix = p.suffix.lower()
            if suffix == ".txt":
                text = data.decode("utf-8", "replace")
            elif suffix == ".pdf":
                text = pdf_to_text_ocr(data, True)
            else:  # a photo or scan of a judgment page
                text = ocr_mod.extract_image(data).text
            year_m = re.search(r"\b(19[5-9]\d|20[0-4]\d)\b", text[:3000])
            year = int(year_m.group(1)) if year_m else datetime.fromtimestamp(p.stat().st_mtime).year
            rec = build_record(rec_id, year, text, {}, "local", "", default_court="Uploaded")
            if rec is None:
                stats["scanned_or_empty"] += 1
            elif store.add_judgment(rec):
                stats["added"] += 1
            elif store.last_skip == "duplicate":
                stats["duplicates"] = stats.get("duplicates", 0) + 1
            else:
                stats["skipped_existing"] += 1
        except Exception as exc:
            stats["failed"] += 1
            progress(f"failed {p.name}: {exc}")
    progress(f"files: {stats}")
    return stats


def probe(year: int, base: str = S3_SC, fetch: Callable[[str], bytes] = http_get, say=print) -> None:
    say(f"Checking access to {base} ...")
    names = list_year(base, year, fetch)
    say(f"{len(names)} English judgments listed for {year}. First few: {names[:3]}")
    if not names:
        return
    stem = names[0][:-4]
    text = pdf_to_text(fetch(f"{base}/data/pdf/year={year}/english/{quote(names[0])}"))
    say(f"First PDF: {len(text)} characters of text. Starts: {clean_text(text)[:200]!r}")
    try:
        meta = json.loads(fetch(f"{base}/metadata/json/year={year}/{quote(stem)}.json"))
        say(f"Metadata keys: {sorted(meta)[:30]}")
    except Exception as exc:
        say(f"Metadata not read ({exc}); titles will be guessed from the text.")


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.ingest", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--corpus", help="path of the database file (default: NYAAI_CORPUS or ./corpus.db)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("sc", help="Supreme Court of India open dataset")
    sc.add_argument("--years", type=int, nargs="*")
    sc.add_argument("--from-year", type=int)
    sc.add_argument("--to-year", type=int)
    sc.add_argument("--limit", type=int, help="max new judgments per year (good for a first small run)")
    sc.add_argument("--workers", type=int, default=4)
    sc.add_argument("--probe", action="store_true", help="only check access and print what the data looks like")
    hcp = sub.add_parser("hc", help="High Court open dataset")
    hcp.add_argument("--courts", nargs="*", default=["27_1"], help="court codes, e.g. 27_1 (Bombay) 7_26 (Delhi)")
    hcp.add_argument("--years", type=int, nargs="*", default=[datetime.now().year - 1])
    hcp.add_argument("--limit", type=int)
    hcp.add_argument("--workers", type=int, default=4)
    hcp.add_argument("--list-courts", action="store_true")
    fl = sub.add_parser("files", help="your own PDF/text judgments in a folder")
    fl.add_argument("folder")
    sub.add_parser("stats")
    sub.add_parser("reindex", help="rebuild citator treatment and parallel citations from stored text")
    em = sub.add_parser("embed", help="build semantic-search vectors (needs: pip install fastembed)")
    em.add_argument("--batch", type=int, default=256)
    args = ap.parse_args(argv)

    store = Store(args.corpus) if args.corpus else get_store()
    if args.cmd == "stats":
        print(json.dumps(store.stats(), indent=2))
        return 0
    if args.cmd == "files":
        ingest_files(store, args.folder)
        store.resolve_parallel()
        return 0
    if args.cmd == "reindex":
        print(f"citator rebuilt for {store.reindex_citator(print)} judgments")
        return 0
    if args.cmd == "embed":
        from .services import vectors
        try:
            print(f"embedded {vectors.build(store, batch=args.batch)} new paragraphs")
        except RuntimeError as exc:
            print(exc)
            return 1
        return 0
    if args.cmd == "hc":
        names = hc_court_names()
        if args.list_courts:
            for code in hc_list_courts(args.years[0]):
                print(f"{code:8} {names.get(code, '')}")
            return 0
        for y in sorted(set(args.years), reverse=True):
            for court in args.courts:
                try:
                    print(ingest_hc(store, y, court, limit=args.limit, workers=args.workers, names=names))
                except FetchError as exc:
                    print(f"Could not read {court} {y}: {exc}\nRun with --list-courts to see what is available.")
        print(json.dumps(store.stats(), indent=2))
        return 0
    years = list(args.years or [])
    if args.from_year:
        years += list(range(args.from_year, (args.to_year or args.from_year) + 1))
    if not years:
        ap.error("give --years 2024 (or --from-year / --to-year)")
    if args.probe:
        probe(years[0])
        return 0
    for y in sorted(set(years), reverse=True):
        try:
            print(ingest_year(store, y, limit=args.limit, workers=args.workers))
        except FetchError as exc:
            print(f"Could not read year {y}: {exc}\nRun again with --probe to see what is reachable.")
            return 1
    print(json.dumps(store.stats(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
