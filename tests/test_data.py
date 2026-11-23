"""Bare Acts, section tags, data quality and the gold set."""
import json
from types import SimpleNamespace

import pytest

from app.services import acts, gold, quality, sections
from app.services.store import Store

# ------------------------------------------------------------------ section references

CASES = [
    ("Under Section 138 of the Negotiable Instruments Act, 1881 the complaint lies.", [("ni", "138", True)]),
    ("Sections 138, 141 and 142 of the N.I. Act were invoked.", [("ni", "138", True), ("ni", "141", True), ("ni", "142", True)]),
    ("Petition u/s 482 Cr.P.C. and s. 302 IPC; also Section 34 of the Indian Penal Code.",
     [("crpc", "482", True), ("ipc", "302", True), ("ipc", "34", True)]),
    ("Articles 226 and 227 of the Constitution of India.", [("const", "226", True), ("const", "227", True)]),
    ("Sections 138 to 141 of the NI Act.", [("ni", str(n), True) for n in range(138, 142)]),
    ("Section 103 BNS and Section 531 of BNSS.", [("bns", "103", True), ("bnss", "531", True)]),
    ("Section 141A of the Act", [("?", "141A", False)]),
    ("Section 482(1)(b) CrPC", [("crpc", "482", True)]),
    # things that must NOT be tagged
    ("Section 7 of the Companies Act, 1956 was repealed.", []),           # a different Act from the 2013 one
    ("Section 37 of the Motor Vehicles Act, 1939.", []),                  # old Act, not the 1988 one
    ("Ravi's 12 cheques bounced in section 3 of the lane.", []),
    ("He relied on Section 5 of the agreement.", []),
    ("Article 5 of the contract between the parties.", []),               # not the Constitution
]


@pytest.mark.parametrize("text,expected", CASES)
def test_extract_refs(text, expected):
    assert sections.extract_refs(text) == expected


def test_bare_the_act_is_resolved_only_when_the_judgment_names_one_act():
    paras = [{"no": 1, "text": "Section 138 of the Negotiable Instruments Act, 1881 applies."},
             {"no": 2, "text": "Section 141 of the Negotiable Instruments Act is also relevant."},
             {"no": 3, "text": "The presumption under Section 139 of the Act arises."}]
    rows = sections.tag_paragraphs(paras)
    assert (3, "ni", "139", 1) in rows and (1, "ni", "138", 0) in rows
    mixed = [{"no": 1, "text": "Section 138 of the NI Act"}, {"no": 2, "text": "Section 482 CrPC"},
             {"no": 3, "text": "Section 139 of the Act"}]
    assert all(r[2] != "139" for r in sections.tag_paragraphs(mixed))  # two Acts named: do not guess


# ------------------------------------------------------------------ Bare Acts

def make_store(tmp_path):
    return Store(tmp_path / "c.db")


def test_civictech_parser_cleans_and_rejects_damaged_files():
    rows = acts.parse_civictech([
        {"section": 138, "section_title": "Dishonour of cheque", "section_desc": "Where any cheque  drawn..."},
        {"section": "153B.", "title": "Title B", "description": "Text B"},
        {"Section": 5, "section_title": "x", "section_desc": ""}])
    assert [r["no"] for r in rows] == ["138", "153B", "5"] and rows[0]["text"] == "Where any cheque drawn..."
    with pytest.raises(acts.ActImportError, match="damaged"):
        acts.parse_civictech([{"chapter,section,section_title,section_desc": "1,1,Short title,x"}])
    with pytest.raises(acts.ActImportError):
        acts.parse_civictech([])


def test_save_act_search_by_number_and_by_words(tmp_path):
    st = make_store(tmp_path)
    rows = [{"no": "138", "heading": "Dishonour of cheque for insufficiency of funds",
             "text": "Where any cheque drawn by a person is returned by the bank unpaid, he shall be deemed to have committed an offence."},
            {"no": "139", "heading": "Presumption in favour of holder", "text": "It shall be presumed that the holder received the cheque for the discharge of a debt."},
            {"no": "141A", "heading": "Added", "text": "Text."}]
    rep = acts.save_act(st, "ni", rows, source="test")
    assert rep["count"] == 3
    assert acts.search_sections(st, "138")[0]["no"] == "138"
    assert acts.search_sections(st, "section 138 ni")[0]["act"] == "ni"
    assert acts.search_sections(st, "138 ipc") == [] or all(r["act"] != "ni" for r in acts.search_sections(st, "138 ipc") if r["exact"])
    hits = acts.search_sections(st, "presumed holder cheque")
    assert hits and hits[0]["no"] == "139" and "<mark>" in hits[0]["snippet"]
    s = acts.get_section(st, "ni", "139")
    assert s["prev"]["no"] == "138" and s["next"]["no"] == "141A"
    assert acts.get_section(st, "ni", "999") is None
    # saving again replaces, it does not duplicate
    acts.save_act(st, "ni", rows[:2], source="test")
    assert acts.get_act(st, "ni")["n_sections"] == 2 and len(acts.search_sections(st, "cheque")) >= 1


def test_wrong_section_count_for_the_sanhitas_is_refused_and_nothing_changes(tmp_path):
    st = make_store(tmp_path)
    good = [{"no": str(i), "heading": "h", "text": "t"} for i in range(1, 359)]
    acts.save_act(st, "bns", good, source="test", official=True)
    with pytest.raises(acts.ActImportError, match="358"):
        acts.save_act(st, "bns", good[:300], source="test")
    assert acts.get_act(st, "bns")["n_sections"] == 358  # the good copy is still there
    with pytest.raises(acts.ActImportError):
        acts.save_act(st, "nonsense", good, source="test")


GAZETTE = """THE BHARATIYA TEST SANHITA, 2024
ARRANGEMENT OF SECTIONS
CHAPTER I
1. Short title.
2. Definitions.
3. Punishment for theft.
4A. Not a real entry
THE BHARATIYA TEST SANHITA, 2024
Page 1
CHAPTER I PRELIMINARY
1. Short title and commencement.—(1) This Sanhita may be called the Test Sanhita, 2024.
(2) It shall come into force on such date as the Central Government may appoint.
THE BHARATIYA TEST SANHITA, 2024
2. Definitions.—In this Sanhita, unless the context otherwise requires,—
1. "act" denotes as well a series of acts as a single act;
2. "animal" means any living creature, other than a human being;
3. "child" means a person below eighteen years.
3. Punishment for theft.—Whoever commits theft shall be punished with imprisonment up to three years.
3A. Punishment for aggravated theft.—Whoever commits theft with a weapon shall be punished more severely.
4. Punishment for robbery.—Whoever commits robbery shall be punished with rigorous imprisonment.
THE BHARATIYA TEST SANHITA, 2024
"""


def test_official_text_splitter_ignores_toc_headers_and_inner_numbered_lists():
    pad = "\n".join(["THE BHARATIYA TEST SANHITA, 2024"] * 10)  # repeated running header on many pages
    rows = acts.parse_official_text(GAZETTE + pad)
    assert [r["no"] for r in rows] == ["1", "2", "3", "3A", "4"]
    assert rows[0]["heading"] == "Short title and commencement"
    assert "may appoint" in rows[0]["text"] and "THE BHARATIYA" not in rows[0]["text"]
    assert '"animal" means' in rows[1]["text"]  # the list "1. 2. 3." inside section 2 did not start new sections
    assert rows[3]["heading"] == "Punishment for aggravated theft"


def test_official_text_count_must_match_when_known():
    with pytest.raises(acts.ActImportError, match="358"):
        acts.parse_official_text(GAZETTE, expected=358)
    with pytest.raises(acts.ActImportError, match="OCR"):
        acts.parse_official_text("Nothing numbered here at all.")
    assert len(acts.parse_official_text(GAZETTE, expected=5)) == 5


def test_import_official_stores_official_flag(tmp_path):
    st = make_store(tmp_path)
    # the three Sanhitas must have the right count: build a synthetic text with 170 sections
    text = "\n".join(f"{i}. Heading {i}.—Text of section {i}." for i in range(1, 171))
    rep = acts.import_official(st, "bsa", text, "https://example.test/bsa.pdf", "bsa.pdf")
    assert rep["count"] == 170
    a = [x for x in acts.list_acts(st) if x["code"] == "bsa"][0]
    assert a["loaded"] and a["official"] and a["n_sections"] == 170


def test_mapping_and_section_view(tmp_path):
    st = make_store(tmp_path)
    acts.save_act(st, "ipc", [{"no": "302", "heading": "Punishment for murder", "text": "Whoever commits murder..."},
                              {"no": "309", "heading": "Attempt to commit suicide", "text": "..."}], source="t")
    good = [{"no": str(i), "heading": "h", "text": "t"} for i in range(1, 359)]
    acts.save_act(st, "bns", good, source="t")
    data = [{"status": "Retained", "mapping_statement": "IPC 302 corresponds to BNS 103",
             "source": {"act": "Indian Penal Code, 1860", "section": "302"},
             "target": {"act": "Bharatiya Nyaya Sanhita, 2023", "section": "103"}},
            {"status": "Deleted", "mapping_statement": "IPC 309 repealed",
             "source": {"act": "Indian Penal Code, 1860", "section": "309"}, "target": None}]
    assert acts.save_mapping(st, acts.parse_mapping(data)) == 2
    s = acts.get_section(st, "ipc", "302")
    assert s["new"][0]["new_act"] == "bns" and s["new"][0]["new_no"] == "103"
    assert acts.get_section(st, "bns", "103")["old"][0]["old_no"] == "302"
    assert acts.get_section(st, "ipc", "309")["deleted_in_new"]["status"] == "Deleted"


def test_import_catalog_continues_past_a_bad_file(tmp_path):
    st = make_store(tmp_path)
    ni = json.dumps([{"chapter": 1, "section": 138, "section_title": "Dishonour", "section_desc": "Text"}]).encode()
    bad = b"<html>rate limited</html>"

    def fetch(url):
        if "nia.json" in url:
            return ni
        if "ipc.json" in url:
            return bad
        raise OSError("offline")

    log = []
    r = acts.import_catalog(st, ["ni", "ipc", "crpc"], progress=log.append, fetch=fetch)
    assert r["imported"] == ["ni"] and set(r["failed"]) == {"ipc", "crpc"}
    assert acts.get_act(st, "ni")["n_sections"] == 1 and acts.get_act(st, "ipc") is None


# ------------------------------------------------------------------ tagging inside the library

BODY = ("The appellant issued a cheque towards repayment of a loan. The cheque was returned unpaid with the remark "
        "funds insufficient and the statutory notice was served within the period of limitation. ")


def rec(jid, texts, **kw):
    paras = [{"no": i + 1, "text": t} for i, t in enumerate(texts)]
    d = {"id": jid, "title": kw.pop("title", "A v. B"), "court": "Supreme Court of India", "decision_date": "2024-03-12",
         "year": 2024, "citations": ["2024 INSC 1"], "source": "test", "paragraphs": paras, "own_norms": []}
    d.update(kw)
    return d


def test_judgments_are_tagged_when_stored_and_search_can_filter_by_section(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("j1", [BODY + "Section 138 of the Negotiable Instruments Act, 1881 applies. " * 2] + [BODY] * 5,
                        citations=["2024 INSC 1"]))
    st.add_judgment(rec("j2", [BODY + "Section 482 of the Code of Criminal Procedure, 1973 was invoked."] + [BODY + " two"] * 5,
                        title="C v. D", citations=["2024 INSC 2"]))
    assert st.jids_with_section("ni", "138") == {"j1"}
    assert st.jids_with_section("crpc") == {"j2"}
    res = st.search("cheque", act="ni", section="138")
    assert [r["id"] for r in res["results"]] == ["j1"]
    assert {r["id"] for r in st.search("cheque")["results"]} == {"j1", "j2"}
    assert st.search("cheque", act="ni", section="139")["results"] == []
    js = st.judgment_sections("j1")
    assert js[0]["act"] == "ni" and js[0]["section"] == "138" and js[0]["paras"] == [1]
    assert {f["act"] for f in st.section_facets()} == {"ni", "crpc"}
    assert st.section_facets("ni")[0]["section"] == "138"
    # section tags are removed with the judgment
    st.add_judgment(rec("j1", [BODY] * 6), replace=True)
    assert st.jids_with_section("ni", "138") == set()


def test_retag_covers_judgments_stored_before_tagging(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("old", [BODY + "Section 139 of the Negotiable Instruments Act, 1881."] + [BODY] * 5))
    with st.conn() as c:  # make it look like a library built before tagging existed
        c.execute("DELETE FROM section_refs")
        c.execute("UPDATE judgments SET sections_tagged=0")
        c.commit()
    assert st.jids_with_section("ni") == set()
    out = st.retag()
    assert out["judgments"] == 1 and st.jids_with_section("ni", "139") == {"old"}
    assert st.retag()["judgments"] == 0  # nothing left to do


def test_section_judgments_lists_cases_for_a_section(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("j1", [BODY + "Section 138 of the NI Act."] * 6, citations=["2024 INSC 1"]))
    cases = acts.section_judgments(st, "ni", "138")
    assert cases[0]["id"] == "j1" and cases[0]["mentions"] >= 1 and cases[0]["paras"][0] == 1


def test_update_metadata_follows_through_title_index_year_and_citations(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("j1", [BODY] * 6, title="Untitled judgment", decision_date="", year=None, citations=[]))
    ch = st.update_metadata("j1", {"title": "Rajesh v. Balaji", "decision_date": "2019-05-06", "citations": ["2019 INSC 77"]})
    assert set(ch) == {"title", "decision_date", "citations"}
    j = st.get_judgment("j1")
    assert j["year"] == 2019 and j["citations"] == ["2019 INSC 77"]
    assert st.title_candidates("Rajesh Balaji")[0]["id"] == "j1"
    assert st.by_citation("2019 INSC 77") == "j1"
    assert st.update_metadata("j1", {"title": "Rajesh v. Balaji"}) == {}
    with pytest.raises(ValueError):
        st.update_metadata("j1", {"decision_date": "31-02-2020"})
    with pytest.raises(ValueError):
        st.update_metadata("j1", {"source": "x"})
    with pytest.raises(KeyError):
        st.update_metadata("nope", {"title": "x"})


# ------------------------------------------------------------------ data quality

def good(**kw):
    j = {"id": "g", "title": "A v. B", "court": "Supreme Court of India", "decision_date": "2020-01-02", "year": 2020,
         "citations": '["2020 INSC 1"]'}
    j.update(kw)
    return j


GOOD_PARAS = [{"no": i, "text": BODY * 2} for i in range(1, 9)]


def test_a_clean_judgment_scores_100():
    assert quality.check_judgment(good(), GOOD_PARAS) == (100, [])


@pytest.mark.parametrize("change,issue", [
    ({"decision_date": ""}, "missing_date"), ({"decision_date": "2020-13-45"}, "bad_date"),
    ({"decision_date": "2999-01-01"}, "bad_date"), ({"year": 2018}, "year_mismatch"),
    ({"citations": "[]"}, "missing_citation"), ({"court": ""}, "no_court"),
    ({"title": "Judgment dated 12 March"}, "fallback_title"), ({"title": "In re Murugan"}, None),
])
def test_each_metadata_problem_is_found(change, issue):
    score, issues = quality.check_judgment(good(**change), GOOD_PARAS)
    assert (issue in issues) if issue else (issues == [])


def test_text_problems_are_found():
    assert "short" in quality.check_judgment(good(), GOOD_PARAS[:3])[1]
    assert "low_text" in quality.check_judgment(good(), [{"no": i, "text": "short"} for i in range(1, 9)])[1]
    garbled = [{"no": i, "text": "��@#$%^&*~`|\\<>" * 30} for i in range(1, 9)]
    s, iss = quality.check_judgment(good(), garbled)
    assert "garbled" in iss and quality.needs_ocr(iss) and s < 70
    gaps = [{"no": n, "text": BODY * 2} for n in (1, 2, 3, 40, 41, 42, 80, 81, 82, 120)]
    assert "para_gaps" in quality.check_judgment(good(), gaps)[1]
    devanagari = [{"no": i, "text": "यह एक निर्णय का पाठ है जो हिंदी में लिखा गया है। " * 40} for i in range(1, 9)]
    assert "garbled" not in quality.check_judgment(good(), devanagari)[1]  # Hindi/Marathi text is not "garbled"


def test_run_report_list_export_and_rescore(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("ok", [BODY * 2] * 8, title="A v. B"))
    st.add_judgment(rec("bad", [BODY * 3 + "x"] * 2, title="Judgment dated 4 May", decision_date="", year=None,
                        citations=[]))
    st.add_judgment(rec("fx", [BODY] * 6, source="fixture"))
    assert quality.run(st)["checked"] == 2  # the demo fixture is not scored
    rp = quality.report(st)
    assert rp["scored"] == 2 and rp["buckets"]["90-100"] == 1 and rp["share_trustworthy"] == 0.5
    codes = {i["code"]: i["count"] for i in rp["issues"]}
    assert codes["missing_date"] == 1 and codes["short"] == 1 and codes["fallback_title"] == 1
    lst = quality.list_judgments(st, max_score=89)
    assert lst["total"] == 1 and lst["items"][0]["id"] == "bad"
    assert quality.list_judgments(st, issue="short")["total"] == 1
    with pytest.raises(ValueError):
        quality.list_judgments(st, issue="nonsense")
    csv_text = quality.export_csv(st, max_score=89)
    assert "bad" in csv_text and "missing_date" in csv_text and "\nok," not in csv_text
    st.update_metadata("bad", {"title": "X v. Y", "decision_date": "2021-03-04", "citations": ["2021 INSC 9"]})
    r = quality.rescore(st, "bad")
    assert "missing_date" not in r["issues"] and "fallback_title" not in r["issues"]


def test_near_duplicates_with_different_text_are_grouped(tmp_path):
    st = make_store(tmp_path)
    st.add_judgment(rec("a", [BODY + "one"] * 6, title="Rajesh Kumar v. State", citations=["2024 INSC 5"]))
    st.add_judgment(rec("b", [BODY + "two two"] * 6, title="RAJESH KUMAR v. STATE", citations=["x"], source="other"))
    st.add_judgment(rec("c", [BODY + "three three three"] * 6, title="Someone v. Else", citations=["2024 INSC 6"]))
    g = quality.duplicate_groups(st)
    assert len(g) == 1 and set(g[0]["ids"]) == {"a", "b"}


# ------------------------------------------------------------------ gold set

class FakeUser(SimpleNamespace):
    pass


@pytest.fixture()
def gold_env(client):
    """A firm, its owner, and a library with one real-looking judgment."""
    from app.db import SessionLocal
    from app.models import User
    from app.services.store import get_store

    st = get_store()
    jid = "gold-test-1"
    if not st.get_judgment(jid):
        assert st.add_judgment(rec(jid, [BODY + f"Section 138 of the Negotiable Instruments Act, 1881. Held {i}." for i in range(8)],
                                   title="Basalingappa v. Mudibasappa", citations=["2019 INSC 400"], source="test",
                                   decision_date="2019-04-09", year=2019))
    with SessionLocal() as db:
        u = db.query(User).filter_by(email="owner@firm.test").first()
        yield db, st, jid, u


def _filled(db, st, u, jid):
    e = gold.add(db, st, u.firm_id, u, jid, "NI Act s.139 presumption")
    gold.update(db, st, e, {"headnote": "The presumption under s.139 is rebuttable on the standard of preponderance of probabilities.",
                            "held": "Accused need not lead defence evidence to rebut the presumption.", "key_paras": [2, 3]})
    return e


def test_gold_add_requires_a_real_judgment_and_is_unique(gold_env):
    db, st, jid, u = gold_env
    with pytest.raises(gold.GoldError, match="not in the library"):
        gold.add(db, st, u.firm_id, u, "missing-id")
    e = gold.add(db, st, u.firm_id, u, jid, "topic")
    assert e.status == "candidate" and e.title == "Basalingappa v. Mudibasappa" and e.citation == "2019 INSC 400"
    with pytest.raises(gold.GoldError, match="already"):
        gold.add(db, st, u.firm_id, u, jid)
    db.delete(e)
    db.commit()


def test_verification_rules(gold_env):
    db, st, jid, u = gold_env
    e = gold.add(db, st, u.firm_id, u, jid, "NI Act s.139 presumption")
    try:
        with pytest.raises(gold.GoldError, match="headnote"):
            gold.verify(e, st, u)
        gold.update(db, st, e, {"headnote": "The presumption under s.139 is rebuttable on preponderance of probabilities.",
                                "held": "The accused need not lead defence evidence."})
        with pytest.raises(gold.GoldError, match="paragraph numbers"):
            gold.verify(e, st, u)
        gold.update(db, st, e, {"key_paras": [2, 99]})
        with pytest.raises(gold.GoldError, match="no paragraph 99"):
            gold.verify(e, st, u)
        gold.update(db, st, e, {"key_paras": [2, 3]})
        with pytest.raises(gold.GoldError, match="Only an advocate"):
            gold.verify(e, st, FakeUser(role="clerk", enrolment_no="X/1/2000", id=0, name="c"))
        with pytest.raises(gold.GoldError, match="enrolment"):
            gold.verify(e, st, FakeUser(role="advocate", enrolment_no="", id=0, name="a"))
        gold.verify(e, st, u)
        assert e.status == "verified" and e.reviewer_enrolment == "MAH/123/2015" and e.verified_at
        # changing a verified entry takes the verification away: the advocate must read it again
        gold.update(db, st, e, {"held": "A different holding that nobody has read yet."})
        assert e.status == "candidate" and e.reviewer_name == "" and e.verified_at is None
        gold.update(db, st, e, {"held": e.held})  # saving unchanged text changes nothing
        assert e.status == "candidate"
    finally:
        db.delete(e)
        db.commit()


def test_benchmark_and_export(gold_env):
    db, st, jid, u = gold_env
    e = _filled(db, st, u, jid)
    e.topic = "Basalingappa presumption"
    try:
        gold.verify(e, st, u)
        b = gold.benchmark(st, [e], k=10)
        assert b["entries"] == 1 and b["rows"][0]["jid"] == jid
        assert gold.benchmark(st, [], 10)["recall"] is None
        out = gold.export_csv([e])
        assert "verified" in out and "MAH/123/2015" in out and "2 3" in out
    finally:
        db.delete(e)
        db.commit()


def test_suggest_prefers_judgments_that_discuss_the_section(gold_env):
    db, st, jid, u = gold_env
    s = gold.suggest(st, "ni", "138", 5)
    assert any(x["id"] == jid for x in s)
    assert all(x["id"] != jid for x in gold.suggest(st, "ni", "138", 5, exclude=[jid]))
    assert gold.suggest(st, "ni", "9999", 5) == []


# ------------------------------------------------------------------ API

def test_api_gold_flow_and_firm_isolation(client):
    from app.services.store import get_store

    st = get_store()
    jid = "api-gold-1"
    assert st.add_judgment(rec(jid, [BODY + f"Section 138 of the Negotiable Instruments Act, 1881. Case {i}." for i in range(8)],
                               title="P v. Q", citations=["2018 INSC 70"], decision_date="2018-02-02", year=2018))
    r = client.post("/gold", json={"jid": jid, "topic": "s.138 notice"})
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    assert client.post("/gold", json={"jid": jid}).status_code == 409
    assert client.post(f"/gold/{eid}/verify").status_code == 422  # headnote missing
    r = client.patch(f"/gold/{eid}", json={"headnote": "A statutory notice must be given within thirty days of the memo.",
                                          "held": "Notice within 30 days is mandatory under the proviso.",
                                          "key_paras": [1, 2]})
    assert r.status_code == 200 and r.json()["status"] == "candidate"
    r = client.post(f"/gold/{eid}/verify")
    assert r.status_code == 200 and r.json()["status"] == "verified" and r.json()["reviewer_enrolment"]
    assert client.get(f"/gold/for/{jid}").json()["status"] == "verified"
    assert client.get("/gold").json()["counts"]["verified"] >= 1
    assert client.get("/gold/benchmark").json()["entries"] >= 1
    assert "s.138 notice" in client.get("/gold/export.csv").text
    assert client.get("/gold/suggest?act=ni&section=138").status_code == 200
    assert client.get("/gold/suggest?act=zzz").status_code == 404
    assert client.delete(f"/gold/{eid}").status_code == 204
    assert client.get(f"/gold/for/{jid}").json() is None
    assert client.patch("/gold/999999", json={"topic": "x"}).status_code == 404


def test_api_quality_acts_and_tags(client):
    from app.services.store import get_store

    st = get_store()
    assert st.add_judgment(rec("api-q-1", [BODY + f"Section 141 of the Negotiable Instruments Act, 1881. Part {i}." for i in range(7)],
                               title="Judgment dated 3 May", citations=[], decision_date="", year=None))
    assert client.post("/library/quality/run").status_code == 202
    import time

    for _ in range(50):
        if client.get("/library/status").json()["job"]["state"] != "running":
            break
        time.sleep(0.1)
    rp = client.get("/library/quality").json()
    assert rp["scored"] >= 1 and any(i["code"] == "missing_date" and i["count"] >= 1 for i in rp["issues"])
    lst = client.get("/library/quality/list?issue=missing_date").json()
    assert any(x["id"] == "api-q-1" for x in lst["items"])
    assert client.get("/library/quality/list?issue=zzz").status_code == 422
    assert "api-q-1" in client.get("/library/quality/export.csv").text
    r = client.patch("/library/judgments/api-q-1", json={"title": "R v. S", "decision_date": "2017-06-01", "citations": ["2017 INSC 3"]})
    assert r.status_code == 200 and "missing_date" not in r.json()["quality"]["issues"]
    assert client.patch("/library/judgments/api-q-1", json={"decision_date": "bad"}).status_code == 422
    assert client.patch("/library/judgments/none", json={"title": "x"}).status_code == 404
    secs = client.get("/judgments/api-q-1/sections").json()
    assert secs[0]["act"] == "ni" and secs[0]["section"] == "141"
    assert client.get("/research/search?q=cheque&act=ni&section=141").json()["total"] >= 1
    assert client.get("/research/search?q=cheque&act=ni&section=7777").json()["total"] == 0
    assert any(f["act"] == "ni" for f in client.get("/library/sections").json())
    # Bare Acts
    assert client.get("/acts").status_code == 200
    assert client.get("/acts/ni").status_code == 404   # not loaded yet
    assert client.get("/acts/zzz").status_code == 404
    text = "\n".join(f"{i}. Heading {i}.—Text of section {i} about cheques." for i in range(1, 171))
    r = client.post("/acts/upload", data={"code": "bsa"}, files={"file": ("bsa.txt", text.encode(), "text/plain")})
    assert r.status_code == 200 and r.json()["count"] == 170
    r = client.post("/acts/upload", data={"code": "bnss"}, files={"file": ("x.txt", text.encode(), "text/plain")})
    assert r.status_code == 422 and "531" in r.json()["detail"]
    assert client.get("/acts/bsa/12").json()["heading"] == "Heading 12"
    assert client.get("/acts/search?q=12&act=bsa").json()["results"][0]["no"] == "12"
    assert client.get("/acts/bsa/9999").status_code == 404
    assert client.post("/acts/import", json={"codes": ["bns"]}).status_code == 422  # not downloadable: needs official file
