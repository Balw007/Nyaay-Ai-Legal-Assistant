"""Clean judgment text: what search, the citator, the AI and a copied paragraph all depend on.

Synthetic pages modelled on pypdf output of Supreme Court / High Court judgments (no network).
"""
from datetime import date, timedelta

from app import ingest
from app.ingest import (build_record, clean_text, guess_title, normalize_chars, parse_date, split_paragraphs,
                        tidy_title)
from app.services.store import Store, text_hash

BODY = (
    "The appellant issued a cheque towards repayment of a friendly loan. The cheque was returned unpaid with the "
    "remark funds insufficient and the statutory notice was served within the period of limitation. "
)


def sc_pages():
    p1 = """REPORTABLE
2024 INSC 312
IN THE SUPREME COURT OF INDIA
CRIMINAL APPELLATE JURISDICTION
CRIMINAL APPEAL NO. 1456 OF 2024
(Arising out of SLP (Crl.) No. 9021 of 2023)
RAJESH KUMAR AGARWAL …APPELLANT(S)
VERSUS
M/S SHREE BALAJI TRADERS & ANR. …RESPONDENT(S)
J U D G M E N T
1. Leave granted. This appeal arises from a judgment of the High Court which quashed a complaint under
Section 138 of the Negotiable Instruments Act, 1881. """ + BODY + """
2. The learned counsel for the appellant submitted that the High Court erred in holding that the debt was not
legally enforceable. The presumption under
Section
139 of the Act operates in favour of the holder. """ + BODY + """
Signature Not Verified
Digitally signed by
NEETA SAPRA
Date: 2024.03.12
17:45:12 IST
Reason:
Page 1 of 3"""
    p2 = """2024 INSC 312
Rajesh Kumar Agarwal v. Shree Balaji Traders
3. The cheque was issued on 5 January 2023 for Rs.
5,00,000 and the bank informed the complainant on 2 February 2023. The notice was issued on 20 February
2023, within thirty days. The consi-
deration for the cheque was the loan admitted in the reply notice. (a) the signature on the cheque was
admitted; (b) the accused did not lead evidence. """ + BODY + """
4.
The respondents contended that the cheque was given as security. That contention was rejected by the
trial court on appreciation of evidence. The ﬁndings are well reasoned and oﬃcial records support them.
Page 2 of 3"""
    p3 = """2024 INSC 312
Rajesh Kumar Agarwal v. Shree Balaji Traders
5. In the result the appeal is allowed. The order of the High Court is set aside and the complaint is
restored to the file of the learned Magistrate for trial in accordance with law. """ + BODY + """
.......................J.
[ABHAY S. OKA]
NEW DELHI;
MARCH 12, 2024.
Page 3 of 3"""
    return "\x0c".join([p1, p2, p3])


def test_stamps_page_numbers_running_headers_removed():
    t = clean_text(sc_pages())
    for junk in ("Signature Not Verified", "Digitally signed", "NEETA SAPRA", "2024.03.12", "17:45:12", "Reason:",
                 "Page 1 of 3", "Page 3 of 3", "REPORTABLE"):
        assert junk not in t, junk
    # neutral citation kept once (page 1), dropped as a running header on later pages
    assert t.count("2024 INSC 312") == 1
    # running header with the short title, repeated on pages 2 and 3, is gone; the real title on page 1 stays
    assert "Rajesh Kumar Agarwal v. Shree Balaji Traders" not in t
    assert "RAJESH KUMAR AGARWAL" in t


def test_characters_hyphenation_and_bare_paragraph_numbers():
    t = clean_text(sc_pages())
    assert "findings" in t and "official" in t           # ligatures
    assert "consideration" in t                          # hyphenated line break rejoined
    assert "4. The respondents contended" in t           # "4." alone on its line joined to its text
    assert "…" not in t


def test_normalize_keeps_devanagari():
    s = normalize_chars("“न्याय” क्‍ष ­x​")
    assert s == '"न्याय" क्‍ष x'


def test_paragraphs_numbered_with_subparas_and_references_kept_inside():
    paras = split_paragraphs(clean_text(sc_pages()))
    nums = [p["no"] for p in paras if p["no"]]
    assert nums == [1, 2, 3, 4, 5]
    p2 = next(p for p in paras if p["no"] == 2)
    assert "Section 139 of the Act" in p2["text"]          # "Section\n139" did not become paragraph 139
    p3 = next(p for p in paras if p["no"] == 3)
    assert "(a) the signature" in p3["text"] and "(b) the accused" in p3["text"]
    assert "Rs. 5,00,000" in p3["text"] or "Rs.5,00,000" in p3["text"].replace(" ", "")


def test_reference_word_before_number_is_not_a_new_paragraph():
    text = "1. First para text here.\n2. Second para refers to para\n3 of the earlier judgment and continues.\n" \
           "3. Third para.\n4. Fourth para."
    nums = [p["no"] for p in split_paragraphs(text)]
    assert nums == [1, 2, 3, 4]
    assert "para 3 of the earlier judgment" in split_paragraphs(text)[1]["text"]


def test_money_after_number_is_not_a_paragraph():
    text = "1. One.\n2. The amount was Rs\n3. lakh and more.\n3. Three.\n4. Four."
    paras = split_paragraphs(text)
    assert [p["no"] for p in paras] == [1, 2, 3, 4]


def test_titles():
    assert tidy_title("RAJESH KUMAR AGARWAL …APPELLANT(S) VERSUS M/S SHREE BALAJI TRADERS & ANR. …RESPONDENT(S)") == \
        "Rajesh Kumar Agarwal v. M/s Shree Balaji Traders & Anr."
    assert tidy_title("STATE OF MAHARASHTRA VS. ABC PVT. LTD.") == "State of Maharashtra v. Abc Pvt. Ltd."
    assert tidy_title("UOI & ORS. V/S HDFC BANK LTD.") == "UOI & Ors. v. HDFC Bank Ltd."
    assert tidy_title("Rajesh Kumar v. State of U.P.") == "Rajesh Kumar v. State of U.P."
    assert tidy_title("") == ""
    t = guess_title(clean_text(sc_pages()), "fallback")
    assert t == "Rajesh Kumar Agarwal v. M/s Shree Balaji Traders & Anr."


def test_high_court_title():
    head = ("IN THE HIGH COURT OF JUDICATURE AT BOMBAY\nCRIMINAL APPELLATE JURISDICTION\n"
            "CRIMINAL APPLICATION NO. 77 OF 2024\nRamesh s/o Ganpat Patil ..Applicant\nVersus\n"
            "The State of Maharashtra ..Respondent\nCORAM : A. B. JUSTICE\n1. text")
    assert guess_title(head, "x") == "Ramesh s/o Ganpat Patil v. The State of Maharashtra"


def test_dates_validated():
    future = (date.today() + timedelta(days=40)).isoformat()
    assert parse_date("2024-03-12", 2024) == "2024-03-12"
    assert parse_date("12-03-2024", 2024) == "2024-03-12"
    assert parse_date(future, date.today().year) == ""                # never a future date
    assert parse_date("2011-03-12", 2024) == ""                       # wrong year in metadata, no text
    assert parse_date("2011-03-12", 2024, clean_text(sc_pages())) == "2024-03-12"  # "MARCH 12, 2024." at the end
    assert parse_date("", 2023, "Dated: 07.08.2023\nOrder") == "2023-08-07"


def test_build_record_end_to_end():
    rec = build_record("sc-2024-x", 2024, sc_pages(), {"citation": "2024 INSC 312"}, "sc-open-data", "")
    assert rec["title"] == "Rajesh Kumar Agarwal v. M/s Shree Balaji Traders & Anr."
    assert rec["decision_date"] == "2024-03-12"
    assert [p["no"] for p in rec["paragraphs"] if p["no"]] == [1, 2, 3, 4, 5]
    assert all("Digitally signed" not in p["text"] for p in rec["paragraphs"])


def _rec(rid, paras, cites=None, own=None):
    return {"id": rid, "title": "A v. B", "court": "Supreme Court of India", "decision_date": "2024-03-12",
            "year": 2024, "citations": cites or [], "source": "test", "paragraphs": paras, "own_norms": own or []}


def test_duplicates_by_text_and_neutral_citation(tmp_path):
    st = Store(tmp_path / "c.db")
    paras = [{"no": i, "text": BODY} for i in range(1, 6)]
    assert st.add_judgment(_rec("a", paras, ["2024 INSC 312"], ["2024 INSC 312"]))
    # same words, different layout/punctuation -> same judgment
    paras2 = [{"no": i, "text": BODY.upper().replace(".", " .")} for i in range(1, 6)]
    assert st.add_judgment(_rec("b", paras2)) is False and st.last_skip == "duplicate"
    # different text but the same neutral citation in the citation field -> same judgment
    other = [{"no": 1, "text": "Completely different text " * 20}]
    assert st.add_judgment(_rec("c", other, ["2024 INSC 312"], ["2024 INSC 312"])) is False
    # the neutral citation only appearing in text (not the citation field) is a citation, not an identity
    assert st.add_judgment(_rec("d", [{"no": 1, "text": "Another judgment entirely " * 20}], [], ["2024 INSC 312"]))
    assert "b" in st.existing_ids() and "c" in st.existing_ids()  # remembered, not re-fetched
    q = st.quality_report()
    assert q["duplicates_skipped"] == 2 and q["judgments"] == 2
    assert st.add_judgment(_rec("a", paras)) is False and st.last_skip == "exists"


def test_text_hash_ignores_case_and_punctuation():
    a = [{"text": BODY}]
    b = [{"text": BODY.upper().replace(",", "")}]
    assert text_hash(a) == text_hash(b) != ""
    assert text_hash([{"text": "too short"}]) == ""


def test_old_library_gets_text_hash_column(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript("CREATE TABLE judgments(id TEXT PRIMARY KEY, title TEXT, court TEXT, decision_date TEXT, "
                    "year INTEGER, citations TEXT, bench TEXT, disposal TEXT, source TEXT, source_url TEXT, "
                    "n_paras INTEGER DEFAULT 0, summary TEXT);"
                    "INSERT INTO judgments(id,title,source) VALUES('old','Old v. Case','sc-open-data');")
    c.commit()
    c.close()
    st = Store(path)
    cols = {r[1] for r in sqlite3.connect(path).execute("PRAGMA table_info(judgments)")}
    assert "text_hash" in cols
    assert st.quality_report()["judgments"] == 1


def test_quality_report_counts(tmp_path):
    st = Store(tmp_path / "c.db")
    st.add_judgment(_rec("good", [{"no": i, "text": BODY + str(i)} for i in range(1, 7)], ["2024 INSC 1"], ["2024 INSC 1"]))
    bad = _rec("bad", [{"no": 1, "text": "Short judgment text " * 10}])
    bad.update(title="ORDER", decision_date="")
    st.add_judgment(bad)
    st.mark_skipped("scan-1", "scanned_or_empty")
    q = st.quality_report()
    assert q == {**q, "judgments": 2, "missing_date": 1, "missing_citation": 1, "short": 1, "fallback_title": 1,
                 "duplicates_skipped": 0, "scanned_skipped": 1}
    assert 0 < q["clean_share"] < 1


def test_scanned_pdfs_are_not_refetched(tmp_path, monkeypatch):
    st = Store(tmp_path / "c.db")
    fetched = []

    def fake_list(base, year, fetch):
        return ["scan.pdf"]

    monkeypatch.setattr(ingest, "list_year", fake_list)
    monkeypatch.setattr(ingest, "pdf_to_text", lambda data: "")

    def fetch(url):
        fetched.append(url)
        return b"{}"

    s1 = ingest.ingest_year(st, 2024, fetch=fetch, progress=lambda m: None)
    assert s1["scanned_or_empty"] == 1
    n = len(fetched)
    s2 = ingest.ingest_year(st, 2024, fetch=fetch, progress=lambda m: None)
    assert s2["skipped_existing"] == 1 and len(fetched) == n


def test_library_status_includes_quality(client):
    s = client.get("/library/status").json()
    assert {"judgments", "missing_date", "duplicates_skipped", "clean_share"} <= set(s["quality"])


def test_title_stops_before_date_and_empty_brackets():
    from app.ingest import tidy_title

    assert tidy_title("K RASHIK VERSUS NATIONAL INSURANCE COMPANY LTD. AND ANOTHER ( ) 16 SEPTEMBER 2026") == \
        "K Rashik v. National Insurance Company Ltd. & Anr."
    assert tidy_title("K Rashik v. National Insurance Company Ltd. and Another ( ) 16 Septemb") == \
        "K Rashik v. National Insurance Company Ltd. & Anr."
    assert tidy_title("STATE OF U.P. AND ORS. VERSUS RAM KUMAR 12.03.2024") == "State of U.P. & Ors. v. Ram Kumar"
    assert tidy_title("M/S SHARMA & CO. VERSUS UNION OF INDIA AND OTHERS JUDGMENT") == "M/s Sharma & Co. v. Union of India & Ors."
