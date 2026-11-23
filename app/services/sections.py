"""Which Act and section does a judgment talk about?

`extract_refs(text)` finds references such as
    "Section 138 of the Negotiable Instruments Act, 1881"   "Sections 138, 141 and 142 of the N.I. Act"
    "u/s 482 Cr.P.C."   "s. 302 IPC"   "Article 226 of the Constitution"   "Section 139 of the Act"
and returns (act, section) pairs. "of the Act" is resolved only when the judgment itself names exactly one Act most of
the time (see `resolve_context_act`); such pairs are marked inferred, so nobody mistakes them for explicit mentions.

It does not read minds: a number that is not followed by a recognisable Act name and is not covered by the rule
above is left out. A missing tag is better than a wrong one.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Iterable, Optional

# code -> (display name, [regex alternatives, matched case-insensitively against the words after the section number])
ACTS: dict = {
    "ni": ("Negotiable Instruments Act, 1881", [r"negotiable\s+instruments?\s+act", r"n\.?\s?i\.?\s*act", r"nia\b"]),
    "ipc": ("Indian Penal Code, 1860", [r"indian\s+penal\s+code", r"i\.?\s?p\.?\s?c\b\.?"]),
    "bns": ("Bharatiya Nyaya Sanhita, 2023", [r"bharatiya\s+nyaya\s+sanhita", r"b\.?\s?n\.?\s?s\b\.?(?!\s?s)"]),
    "crpc": ("Code of Criminal Procedure, 1973", [r"code\s+of\s+criminal\s+procedure", r"criminal\s+procedure\s+code",
                                                 r"cr\.?\s?p\.?\s?c\b\.?"]),
    "bnss": ("Bharatiya Nagarik Suraksha Sanhita, 2023", [r"bharatiya\s+nagarik\s+suraksha\s+sanhita", r"b\.?\s?n\.?\s?s\.?\s?s\b\.?"]),
    "iea": ("Indian Evidence Act, 1872", [r"indian\s+evidence\s+act", r"evidence\s+act"]),
    "bsa": ("Bharatiya Sakshya Adhiniyam, 2023", [r"bharatiya\s+sakshya\s+adhiniyam", r"b\.?\s?s\.?\s?a\b\.?"]),
    "cpc": ("Code of Civil Procedure, 1908", [r"code\s+of\s+civil\s+procedure", r"civil\s+procedure\s+code", r"c\.?\s?p\.?\s?c\b\.?"]),
    "limitation": ("Limitation Act, 1963", [r"limitation\s+act"]),
    "arbitration": ("Arbitration and Conciliation Act, 1996", [r"arbitration\s+(?:and|&)\s+conciliation\s+act", r"arbitration\s+act"]),
    "it": ("Information Technology Act, 2000", [r"information\s+technology\s+act", r"i\.?\s?t\.?\s*act"]),
    "hma": ("Hindu Marriage Act, 1955", [r"hindu\s+marriage\s+act", r"h\.?\s?m\.?\s?a\b\.?"]),
    "dv": ("Protection of Women from Domestic Violence Act, 2005",
           [r"protection\s+of\s+women\s+from\s+domestic\s+violence\s+act", r"domestic\s+violence\s+act", r"d\.?\s?v\.?\s*act"]),
    "mv": ("Motor Vehicles Act, 1988", [r"motor\s+vehicles?\s+act", r"m\.?\s?v\.?\s*act"]),
    "sarfaesi": ("SARFAESI Act, 2002", [r"sarfaesi\s+act", r"securitisation\s+and\s+reconstruction\s+of\s+financial\s+assets"]),
    "ibc": ("Insolvency and Bankruptcy Code, 2016", [r"insolvency\s+(?:and|&)\s+bankruptcy\s+code", r"i\.?\s?b\.?\s?c\b\.?"]),
    "contract": ("Indian Contract Act, 1872", [r"indian\s+contract\s+act", r"contract\s+act"]),
    "sra": ("Specific Relief Act, 1963", [r"specific\s+relief\s+act"]),
    "tpa": ("Transfer of Property Act, 1882", [r"transfer\s+of\s+property\s+act", r"t\.?\s?p\.?\s*act"]),
    "ndps": ("NDPS Act, 1985", [r"narcotic\s+drugs\s+and\s+psychotropic\s+substances\s+act", r"n\.?\s?d\.?\s?p\.?\s?s\.?\s*act"]),
    "pocso": ("POCSO Act, 2012", [r"protection\s+of\s+children\s+from\s+sexual\s+offences\s+act", r"p\.?\s?o\.?\s?c\.?\s?s\.?\s?o\.?\s*act"]),
    "companies": ("Companies Act, 2013", [r"companies\s+act"]),
    "const": ("Constitution of India", [r"constitution(?:\s+of\s+india)?"]),
}
SHORT = {"ni": "NI Act", "ipc": "IPC", "bns": "BNS", "crpc": "CrPC", "bnss": "BNSS", "iea": "Evidence Act", "bsa": "BSA",
         "cpc": "CPC", "limitation": "Limitation Act", "arbitration": "Arbitration Act", "it": "IT Act",
         "hma": "HMA", "dv": "DV Act", "mv": "MV Act", "sarfaesi": "SARFAESI", "ibc": "IBC", "contract": "Contract Act",
         "sra": "Specific Relief Act", "tpa": "TP Act", "ndps": "NDPS", "pocso": "POCSO", "companies": "Companies Act",
         "const": "Constitution"}

_ALT = sorted(((code, pat) for code, (_, pats) in ACTS.items() for pat in pats if code != "const"),
              key=lambda x: -len(x[1]))
_ACT_RE = re.compile("|".join(f"(?P<{code}_{i}>{pat})" for i, (code, pat) in enumerate(_ALT)), re.I)
_GROUP_CODE = {f"{code}_{i}": code for i, (code, _) in enumerate(_ALT)}

_NUM = r"\d{1,4}[A-Z]{0,3}(?:\s?\(\w{1,4}\))*"
_LIST = rf"{_NUM}(?:\s*(?:,|and|&|to|or|/|read with|r/w)\s*{_NUM})*"
SECTION_RE = re.compile(rf"(?:\b(?:sections?|secs?|ss?|u/ss?)\b\.?|§)\s*(?P<nums>{_LIST})", re.I)
ARTICLE_RE = re.compile(rf"\b(?:articles?|arts?)\b\.?\s*(?P<nums>{_LIST})(?P<tail>[^.;]{{0,60}})", re.I)
_TAIL = 110  # how far after the numbers an Act name may sit ("of the ... Act, 1881")
_OF_THE_ACT = re.compile(r"^\W{0,3}(?:of|under|in|to)?\s*(?:the\s+)?(?:said|aforesaid|impugned|present|this|that)?\s*act\b", re.I)
_BARE_ACT_LINK = re.compile(r"^[\s,]*(?:of|under|in)?\s*(?:the\s+)?(?:said|aforesaid|impugned|present|this)?\s*(?:act|code|sanhita)\b", re.I)


def clean_section(raw: str) -> Optional[str]:
    """'138(1)(b)' -> '138'; '141 A' -> '141A'. Sub-sections are dropped on purpose: search is by section."""
    m = re.match(r"\s*(\d{1,4})\s?([A-Za-z]{0,3})", raw)
    if not m:
        return None
    n = int(m.group(1))
    if n == 0:
        return None
    return f"{n}{m.group(2).upper()}"


def _numbers(listing: str) -> list:
    """Split '138, 141 and 142', '138 to 142', '482/483' into section numbers."""
    parts = re.split(r"\s*(?:,|and|&|or|/|read with|r/w)\s*|\s+to\s+", listing, flags=re.I)
    secs = [s for s in (clean_section(p) for p in parts if p.strip()) if s]
    if re.search(r"\sto\s", listing, re.I) and len(secs) == 2:  # "138 to 142": a short range is every section in it
        a, b = (int(re.match(r"\d+", s).group()) for s in secs)
        if secs[0].isdigit() and secs[1].isdigit() and 0 < b - a <= 12:
            return [str(i) for i in range(a, b + 1)]
    return secs


_YEAR = {"ni": 1881, "ipc": 1860, "bns": 2023, "crpc": 1973, "bnss": 2023, "iea": 1872, "bsa": 2023, "cpc": 1908,
         "limitation": 1963, "arbitration": 1996, "it": 2000, "hma": 1955, "dv": 2005, "mv": 1988, "sarfaesi": 2002,
         "ibc": 2016, "contract": 1872, "sra": 1963, "tpa": 1882, "ndps": 1985, "pocso": 2012, "companies": 2013}
_LEAD = re.compile(r"[\s,]*(?:of|under|in|to)?\s*(?:the\s+)?(?:said\s+)?", re.I)
_YEAR_AFTER = re.compile(r",?\s*(?:of\s+)?(1[89]\d\d|20\d\d)\b")


def _act_after(text: str, end: int) -> Optional[str]:
    """Act code if the words just after position `end` name one: 'of the Negotiable Instruments Act', 'Cr.P.C.'.
    A year after the name must be the year of that Act (the Companies Act, 1956 is not the 2013 Act, and the Motor
    Vehicles Act, 1939 is not the 1988 Act), and the Companies Act must carry a year at all."""
    window = text[end:end + _TAIL]
    m = _ACT_RE.match(window, _LEAD.match(window).end())
    if not m:
        return None
    code = _GROUP_CODE[m.lastgroup]
    y = _YEAR_AFTER.match(window, m.end())
    if y and code in _YEAR and int(y.group(1)) != _YEAR[code]:
        return None
    if code == "companies" and not y:
        return None
    return code


def extract_refs(text: str) -> list:
    """[(act, section, explicit)] in order of appearance, one entry per distinct pair. explicit=False means the text said
    'of the Act' and nothing else: callers resolve those with resolve_context_act()."""
    out, seen = [], set()
    for m in SECTION_RE.finditer(text):
        nums = _numbers(m.group("nums"))
        if not nums:
            continue
        act = _act_after(text, m.end())
        if act:
            explicit = True
        elif _OF_THE_ACT.match(text[m.end():m.end() + 40]) or _BARE_ACT_LINK.match(text[m.end():m.end() + 40]):
            act, explicit = "?", False
        else:
            continue
        for n in nums:
            if (act, n) not in seen:
                seen.add((act, n))
                out.append((act, n, explicit))
    for m in ARTICLE_RE.finditer(text):
        if not re.search(r"\bconstitution\b", m.group("tail"), re.I):
            continue
        for n in _numbers(m.group("nums")):
            if ("const", n) not in seen:
                seen.add(("const", n))
                out.append(("const", n, True))
    return out


def resolve_context_act(explicit_acts: Iterable[str]) -> Optional[str]:
    """The Act that bare 'of the Act' means in this judgment: the one named explicitly in at least 2 references and in
    at least 70% of all explicit references (Constitution articles do not count). Otherwise None: do not guess."""
    c = Counter(a for a in explicit_acts if a not in ("?", "const"))
    if not c:
        return None
    act, n = c.most_common(1)[0]
    return act if n >= 2 and n / sum(c.values()) >= 0.7 else None


def tag_paragraphs(paragraphs: list) -> list:
    """paragraphs [{'no', 'text'}] -> [(para_no, act, section, inferred)] for a whole judgment."""
    per = [(p.get("no"), extract_refs(p["text"])) for p in paragraphs]
    ctx = resolve_context_act(a for _, refs in per for a, _, ex in refs if ex)
    seen, rows = set(), []
    for no, refs in per:
        for act, sec, explicit in refs:
            inferred = not explicit
            if inferred:
                if not ctx:
                    continue
                act = ctx
            key = (no, act, sec)
            if key in seen:
                continue
            seen.add(key)
            rows.append((no, act, sec, int(inferred)))
    return rows


def act_label(code: str) -> str:
    return ACTS.get(code, (code,))[0]


def sort_key(section: str) -> tuple:
    m = re.match(r"(\d+)(.*)", section)
    return (int(m.group(1)), m.group(2)) if m else (10 ** 6, section)
