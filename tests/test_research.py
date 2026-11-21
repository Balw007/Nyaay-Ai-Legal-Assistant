import io
import json

import pytest
from fastapi.testclient import TestClient

from app import ingest
from app.services import research as rs
from app.services.llm import NullLLM
from app.services.store import Store, StoreIndex, fts_query, seed_demo

BODY = [
    "1. This appeal arises from the dishonour of a cheque issued by the appellant in discharge of a legally enforceable debt owed to the respondent company for goods supplied during the year.",
    "2. The question is whether the presumption under Section 139 of the Negotiable Instruments Act stands rebutted merely because the accused denies the signature on the cheque before the trial court.",
    "3. We hold that the presumption under Section 139 is a rule of evidence and the burden shifts to the accused who must raise a probable defence on a preponderance of probabilities in this matter.",
    "4. Reliance was placed on (2019) 5 SCC 418 where this Court considered the statutory presumption and the standard of proof required of the accused in proceedings under Section 138.",
    "5. In the result the appeal is dismissed and the conviction recorded by the courts below is affirmed with costs payable to the respondent within a period of eight weeks from today.",
]


def make_pdf(title, paras):
    """Minimal hand-written PDF (no external library, works on any Python)."""
    lines = []
    for line in [title] + paras:
        cur = ""
        for w in line.split():
            if len(cur) + len(w) > 95:
                lines.append(cur); cur = w
            else:
                cur = (cur + " " + w).strip()
        lines.append(cur)
    esc = lambda t: t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = "BT /F1 9 Tf 40 800 Td 13 TL\n" + "\n".join(f"({esc(l)}) '" for l in lines if l) + "\nET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out)); out += f"{i} 0 obj\n{o}\nendobj\n".encode()
    x = len(out)
    out += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
    for o in offs:
        out += f"{o:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF".encode()
    return out


@pytest.fixture()
def fake_s3():
    pdf = make_pdf("Alpha Traders v. Beta Finance Ltd", BODY)
    meta = {"title": "Alpha Traders v. Beta Finance Ltd", "citation": "2023 INSC 77", "court": "Supreme Court of India",
            "decision_date": "2023-02-14", "judge": "A B C J"}
    idx = {"files": ["case_one.pdf", "blank.pdf"]}
    blank = make_pdf("", [])

    def fetch(url):
        if url.endswith("english.index.json"):
            return json.dumps(idx).encode()
        if url.endswith("case_one.pdf"):
            return pdf
        if url.endswith("blank.pdf"):
            return blank
        if url.endswith("case_one.json"):
            return json.dumps(meta).encode()
        raise ingest.FetchError("404 " + url)
    return fetch


def test_ingest_search_and_cites(tmp_path, fake_s3):
    st = Store(tmp_path / "c.db")
    seed_demo(st)
    stats = ingest.ingest_year(st, 2023, fetch=fake_s3, progress=lambda s: None)
    assert stats["added"] == 1 and stats["scanned_or_empty"] == 1
    assert st.stats()["real_judgments"] == 1 and st.stats()["judgments"] == 1  # fixtures purged
    again = ingest.ingest_year(st, 2023, fetch=fake_s3, progress=lambda s: None)
    assert again["added"] == 0 and again["skipped_existing"] == 2  # the scanned PDF is remembered, not re-fetched

    res = st.search("presumption Section 139 burden accused")
    assert res["total"] == 1 and "<mark>" in res["results"][0]["hits"][0]["snippet"]
    assert res["results"][0]["citation"] == "2023 INSC 77"
    assert st.search("banana submarine")["total"] == 0
    assert st.by_citation("2023 INSC 77") == "sc-2023-case_one"
    assert st.links("sc-2023-case_one")["citations_in_text"] == 1


def test_query_is_safe():
    assert fts_query('a "b c" AND OR NOT ( * ') is not None
    assert fts_query("the of") is None


def test_assistant_modes_and_verification(tmp_path, fake_s3):
    st = Store(tmp_path / "c.db")
    ingest.ingest_year(st, 2023, fetch=fake_s3, progress=lambda s: None)
    out = rs.ask(st, NullLLM(), "Who bears the burden under Section 139 presumption?")
    assert out["mode"] == "retrieval_only" and out["sources"]

    class Fake:
        available = True
        name = "fake"
        def json(self, s, u, max_tokens=0):
            return {"answer": "The burden shifts to the accused to raise a probable defence [S1]. "
                              "The court also fixed a ten crore penalty on the respondent in this very matter.[S9]",
                    "confidence": "high", "limitations": ""}
    out = rs.ask(st, Fake(), "Who bears the burden under Section 139 presumption?")
    assert out["mode"] == "answer" and out["checks"]["invalid_markers_removed"] == [9]
    assert "[S9]" not in out["answer"] and out["confidence"] == "low"
    assert out["checks"]["uncited_sentences"]


def test_checker_uses_store(tmp_path, fake_s3):
    st = Store(tmp_path / "c.db")
    ingest.ingest_year(st, 2023, fetch=fake_s3, progress=lambda s: None)
    from app.services import citations as c
    items = c.check_text("As held in Alpha Traders v. Beta Finance Ltd, 2023 INSC 77, the burden shifts to the accused.",
                         StoreIndex(st), NullLLM())
    assert items[0]["status"] in ("EXISTS_UNCHECKED", "VERIFIED")
    items = c.check_text("See Foo v. Bar, 2023 INSC 9999.", StoreIndex(st), NullLLM())
    assert items[0]["status"] == "NOT_IN_LIBRARY"


def test_api(tmp_path, fake_s3, monkeypatch):
    from app.services import store as sm
    st = Store(tmp_path / "c.db")
    ingest.ingest_year(st, 2023, fetch=fake_s3, progress=lambda s: None)
    sm.set_store(st)
    try:
        from app.main import app
        from conftest import signed_in
        with TestClient(app) as cl:
            signed_in(cl)
            r = cl.get("/research/search", params={"q": "presumption burden accused"})
            assert r.status_code == 200 and r.json()["total"] == 1
            jid = r.json()["results"][0]["id"]
            assert len(cl.get(f"/judgments/{jid}").json()["paragraphs"]) >= 5
            assert cl.get("/judgments/nope").status_code == 404
            assert cl.post("/research/ask", json={"question": "burden under section 139?"}).json()["sources"]
            assert cl.get("/research/stats").json()["real_judgments"] == 1
    finally:
        sm.set_store(None)
