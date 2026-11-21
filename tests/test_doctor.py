"""Self-check and review pack. Nothing here touches the network or a real Ollama."""
import io
import zipfile

import pytest

from app import doctor, review_pack


def test_summary_counts_and_verdict():
    s = doctor.summarise([{"status": "PASS"}, {"status": "WARN"}, {"status": "PASS"}])
    assert s == {"pass": 2, "warn": 1, "fail": 0, "ready": True, "verdict": "Usable, with things to improve"}
    assert doctor.summarise([{"status": "FAIL"}])["ready"] is False
    assert doctor.summarise([{"status": "PASS"}])["verdict"] == "Ready to use"


def test_every_failure_comes_with_a_fix(monkeypatch):
    """The point of the doctor: a FAIL or WARN must say what to type."""
    monkeypatch.setattr(doctor, "_ollama_models", lambda: (_ for _ in ()).throw(OSError("refused")))
    monkeypatch.setattr(doctor.config, "LLM_PROVIDER", "ollama")
    r = doctor.check_ollama()
    assert r[0]["status"] == "FAIL" and "ollama" in r[0]["fix"].lower()


def test_missing_models_are_named_with_the_pull_command(monkeypatch):
    monkeypatch.setattr(doctor.config, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(doctor, "_ollama_models", lambda: ["qwen3:4b"])
    r = doctor.check_ollama(quick=True)
    by = {x["name"]: x for x in r}
    assert by["Model qwen3:4b"]["status"] == "PASS"
    assert by["Model qwen3:8b"]["status"] == "FAIL" and by["Model qwen3:8b"]["fix"] == "ollama pull qwen3:8b"
    assert by["Model nomic-embed-text"]["fix"] == "ollama pull nomic-embed-text"


def test_model_names_match_with_or_without_tag():
    assert doctor._has_model(["nomic-embed-text:latest"], "nomic-embed-text")
    assert doctor._has_model(["qwen3:8b"], "qwen3:8b")
    assert not doctor._has_model(["qwen3:4b"], "qwen3:8b")


def test_ollama_generate_and_embed_are_timed(monkeypatch):
    import httpx

    monkeypatch.setattr(doctor.config, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(doctor, "_ollama_models", lambda: ["qwen3:8b", "qwen3:4b", "nomic-embed-text:latest"])

    class R:
        status_code = 200

        def __init__(self, j):
            self.j = j

        def raise_for_status(self):
            pass

        def json(self):
            return self.j

    def post(url, **kw):
        return R({"message": {"content": "ready"}} if url.endswith("/api/chat") else {"embeddings": [[0.1] * 768]})

    monkeypatch.setattr(httpx, "post", post)
    r = {x["name"]: x for x in doctor.check_ollama()}
    assert r["AI answer test"]["status"] == "PASS" and "seconds" in r["AI answer test"]
    assert r["Embedding test"]["status"] == "PASS" and "768" in r["Embedding test"]["detail"]


def test_open_data_unreachable_is_a_clear_fail(monkeypatch):
    from app import ingest

    monkeypatch.setattr(ingest, "list_year", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HTTP 403")))
    r = doctor.check_open_data()
    assert r[0]["status"] == "FAIL" and "amazonaws" in r[0]["fix"]


def test_open_data_downloads_and_cleans_one_judgment(monkeypatch):
    from app import ingest

    body = "\n".join(f"{n}. The appellant relied on the settled position of law on a dishonoured cheque and its consequences "
                     f"for the drawer under the statute in paragraph {n}." for n in range(1, 25))
    monkeypatch.setattr(ingest, "list_year", lambda base, y, f: ["2025_1_1_1_INSC.pdf"])
    monkeypatch.setattr(ingest, "http_get", lambda *a, **k: b"%PDF")
    monkeypatch.setattr(ingest, "pdf_to_text", lambda data: "REPORTABLE\n" + body)
    monkeypatch.setattr(ingest, "hc_list_courts", lambda y: ["27_1", "9_13"])
    r = {x["name"]: x for x in doctor.check_open_data()}
    assert r["Supreme Court open data"]["status"] == "PASS"
    assert r["Judgment cleaning test"]["sample"]["paragraphs"] >= 20
    assert r["High Court open data"]["status"] == "PASS"


def test_one_crashing_check_does_not_stop_the_doctor(monkeypatch):
    monkeypatch.setattr(doctor, "check_ports", lambda: 1 / 0)
    res = doctor.run_checks(quick=True)
    assert any(r["name"] == "ports" and r["status"] == "WARN" for r in res)
    assert any(r["name"] == "Python" for r in res)


def test_system_check_endpoint_needs_admin_and_returns_summary(client, monkeypatch):
    from tests.conftest import signed_in

    monkeypatch.setattr(doctor, "check_ollama", lambda quick=False: [doctor._r("PASS", "Ollama", "ok")])
    r = signed_in(client).get("/system/check")
    assert r.status_code == 200 and "summary" in r.json() and r.json()["full"] is False


# ------------------------------------------------------------------ review pack

def test_review_pack_markdown_has_every_rule_stage_and_template():
    from app.services import drafting as dft
    from app.services import playbook as pbk

    md = review_pack.to_markdown(review_pack.build())
    pb = pbk.get_playbook("ni138")
    for rule in pb["deadline_rules"]:
        assert rule["label"] in md and rule["authority"] in md
    for st in pb["stages"]:
        assert st["name"] in md
    for t in dft.TEMPLATES.values():
        assert t["name"] in md
    assert "Declaration" in md and "Bar Council enrolment number" in md
    assert "DRAFT" in md                                # the playbook's own status line is repeated, not hidden


def test_review_pack_adds_no_section_numbers_of_its_own():
    """Every section reference in Part A comes from the playbook file; the pack invents none."""
    import json
    import re

    from app.services import playbook as pbk

    raw = json.dumps(pbk.get_playbook("ni138"))
    part_a = review_pack.to_markdown(review_pack.build()).split("Part B")[0]
    own_text = "Section 10, General Clauses Act"          # the one reference the product itself writes into deadline notes
    for sec in set(re.findall(r"[Ss](?:ection|\.)\s?\d+[A-Z]?", part_a.replace(own_text, ""))):
        assert sec in raw, sec


def test_review_pack_worked_example_matches_the_product_arithmetic():
    from datetime import date

    from app.services import playbook as pbk

    pb = pbk.get_playbook("ni138")
    r = {d.rule_id: d.due_date for d in pbk.compute_deadlines(pb, {"cheque_date": date(2025, 11, 30)})}
    assert r["ni138_presentation_validity"] == date(2026, 2, 28)        # month-end clamp
    md = review_pack.to_markdown(review_pack.build())
    assert "28 Feb 2026" in md


def test_review_pack_docx_is_a_valid_word_file_with_tables():
    data, media, name = review_pack.render("docx")
    assert name.endswith(".docx") and "wordprocessingml" in media
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        xml = z.read("word/document.xml").decode("utf8")
    assert "<w:tbl>" in xml and "Declaration" in xml


def test_review_pack_endpoint_downloads_and_shows_existing_signoffs(client):
    from tests.conftest import signed_in

    c = signed_in(client)
    r = c.get("/system/review-pack?format=md")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert "Part C. Sign-off" in r.text
    d = c.get("/system/review-pack")
    assert d.status_code == 200 and d.content[:2] == b"PK"
    assert c.get("/system/review-pack?format=pdf").status_code == 422


# ------------------------------------------------------------------ settings file, launcher, backup

def test_env_file_parsing(tmp_path, monkeypatch):
    from app import envfile

    f = tmp_path / ".env"
    f.write_text('# comment\nA=1\nB="two words"\nC=3 # note\nEMPTY=\nPASS=a#b\n', encoding="utf-8")
    assert envfile.parse(f.read_text()) == {"A": "1", "B": "two words", "C": "3", "EMPTY": "", "PASS": "a#b"}


def test_env_file_never_overrides_real_environment(tmp_path, monkeypatch):
    import sys

    from app import envfile

    f = tmp_path / ".env"
    f.write_text("NYAAY_TEST_KEEP=from-file\nNYAAY_TEST_NEW=from-file\n")
    monkeypatch.setenv("NYAAY_TEST_KEEP", "from-env")
    monkeypatch.delenv("NYAAY_TEST_NEW", raising=False)
    monkeypatch.delitem(sys.modules, "pytest")          # the loader is switched off under pytest, so pretend not
    try:
        envfile.load(f)
        import os

        assert os.environ["NYAAY_TEST_KEEP"] == "from-env" and os.environ["NYAAY_TEST_NEW"] == "from-file"
    finally:
        sys.modules["pytest"] = pytest
        import os

        os.environ.pop("NYAAY_TEST_NEW", None)


def test_daily_backup_copies_once_and_keeps_fourteen(tmp_path, monkeypatch):
    import sqlite3

    from app import config, launch

    db = tmp_path / "firm.db"
    sqlite3.connect(db).execute("create table t(x)").connection.commit()
    monkeypatch.setattr(config, "DATABASE_URL", f"sqlite:///{db}")
    monkeypatch.setattr(config, "BACKUP_DIR", str(tmp_path / "b"))
    (tmp_path / "b").mkdir()
    for i in range(20):
        (tmp_path / "b" / f"nyaai-2025010{i % 10}-{i}.db").write_bytes(b"x")
    launch.daily_backup()
    launch.daily_backup()                                # second call the same day does nothing new
    files = sorted((tmp_path / "b").glob("nyaai-*.db"))
    assert len(files) == 14 and any(f.stat().st_size > 1 for f in files)


def test_library_status_reports_ocr_engine(client):
    from tests.conftest import signed_in

    s = signed_in(client).get("/library/status").json()
    assert set(["tesseract", "languages_installed", "ready"]) <= set(s["ocr"]) and "bulk" in s["ocr"]
