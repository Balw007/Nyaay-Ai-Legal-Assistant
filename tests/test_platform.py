"""Accounts, privacy, AI metering, citator, hybrid search, holidays, reviews, integrations."""
import json
from datetime import date, timedelta

import httpx
import pytest
from conftest import PASSWORD

from app.services import llm as llm_mod
from app.services.security import hash_password, redact, restore, verify_password


# ------------------------------------------------------------------ accounts

def test_password_hashing():
    h = hash_password("a long passphrase 1")
    assert verify_password("a long passphrase 1", h) and not verify_password("wrong", h)
    assert h.startswith("scrypt$") and "a long" not in h


def test_auth_required_and_csrf(anon):
    assert anon.get("/matters").status_code == 401
    r = anon.post("/auth/login", json={"email": "x@y.z", "password": "nope"}, headers={"X-Requested-With": ""})
    assert r.status_code == 403  # custom header required on state-changing requests
    assert anon.get("/health").status_code == 200


def test_setup_only_once_and_login(client, anon):
    r = anon.post("/auth/setup", json={"firm_name": "X", "name": "Y", "email": "z@z.zz", "password": PASSWORD})
    assert r.status_code == 409
    assert anon.post("/auth/login", json={"email": "owner@firm.test", "password": "bad password"}).status_code == 401
    assert anon.post("/auth/login", json={"email": "owner@firm.test", "password": PASSWORD}).status_code == 200
    assert anon.get("/auth/me").json()["user"]["role"] == "owner"
    anon.post("/auth/logout")
    assert anon.get("/auth/me").status_code == 401


def test_login_throttle(anon):
    for _ in range(6):
        anon.post("/auth/login", json={"email": "victim@firm.test", "password": "guess"})
    assert anon.post("/auth/login", json={"email": "victim@firm.test", "password": "guess"}).status_code == 429


def test_invite_and_clerk_cannot_approve(client, anon):
    r = client.post("/team/invites", json={"email": "clerk@firm.test", "role": "clerk"})
    assert r.status_code == 201
    token = r.json()["link"].split("invite=")[1]
    assert anon.get(f"/auth/invite/{token}").json()["role"] == "clerk"
    assert anon.post("/auth/accept", json={"token": token, "name": "Clerk", "password": "short"}).status_code == 422
    assert anon.post("/auth/accept", json={"token": token, "name": "Clerk", "password": "clerk passphrase 1"}).status_code == 201
    assert anon.post("/auth/accept", json={"token": token, "name": "Clerk", "password": "clerk passphrase 1"}).status_code == 404
    m = client.post("/matters", json={"title": "A v. B"}).json()
    client.post(f"/matters/{m['id']}/orders", data={"text": "Order dated 01.11.2026. Put up on 20.12.2026."})
    tid = client.get(f"/tasks?matter_id={m['id']}&status=proposed").json()[0]["id"]
    assert anon.post(f"/tasks/{tid}/approve", json={}).status_code == 403  # clerk
    assert anon.post("/team/invites", json={"email": "x@firm.test"}).status_code == 403
    assert client.post(f"/tasks/{tid}/approve", json={}).status_code == 200
    assert any(u["email"] == "clerk@firm.test" for u in client.get("/team").json()["users"])


# ------------------------------------------------------------------ privacy & AI metering

def test_redaction_round_trip():
    t = "PAN ABCDE1234F, phone 9876543210, mail a.b@x.in, Aadhaar 2345 6789 0123, IFSC HDFC0001234."
    red, mp = redact(t)
    for secret in ("ABCDE1234F", "9876543210", "a.b@x.in", "2345 6789 0123", "HDFC0001234"):
        assert secret not in red
    assert restore(red, mp) == t
    assert restore({"x": [red]}, mp) == {"x": [t]}


class Recorder(llm_mod.LLM):
    available, name = True, "anthropic"

    def __init__(self):
        self.seen = []
        self.last_usage = (100, 50)

    def json(self, system, user, max_tokens=1500, model=None):
        self.seen.append((user, model))
        return {"answer": "Echo: " + user[:40], "confidence": "low", "limitations": ""}


def test_firm_llm_redacts_meters_and_budgets(client):
    from app.db import SessionLocal
    from app.services.ai import firm_llm, month_usage

    rec = Recorder()
    llm_mod.set_llm(rec)
    with SessionLocal() as db:
        f = firm_llm(db, 1, "summary")
        out = f.json("sys", "Call 9876543210 about it")
        assert "9876543210" not in rec.seen[-1][0] and "9876543210" in out["answer"]
        assert rec.seen[-1][1] == "claude-haiku-5-5"  # routine work uses the fast model
        firm_llm(db, 1, "answer").json("sys", "q")
        assert rec.seen[-1][1] == "claude-opus-5-5"
        assert month_usage(db, 1) >= 300
    client.patch("/firm", json={"settings": {"monthly_token_budget": 1}})
    with SessionLocal() as db:
        with pytest.raises(Exception):
            firm_llm(db, 1, "answer").json("sys", "q")
    client.patch("/firm", json={"settings": {"monthly_token_budget": 3000000, "ai_enabled": False}})
    with SessionLocal() as db:
        assert not firm_llm(db, 1, "answer").available  # switched off: nothing is sent
    client.patch("/firm", json={"settings": {"ai_enabled": True}})
    u = client.get("/firm/usage").json()
    assert u["month_tokens"] > 0 and u["by_feature"]
    assert client.patch("/firm", json={"settings": {"nope": 1}}).status_code == 422


def test_export_and_erase(client):
    m = client.post("/matters", json={"title": "Erase Me v. Now"}).json()
    client.post(f"/matters/{m['id']}/notes", json={"body": "secret note"})
    ex = client.get("/firm/export")
    assert ex.status_code == 200 and "Erase Me" in ex.text and "password_hash" not in ex.text
    assert client.delete(f"/matters/{m['id']}").status_code == 204
    assert client.get(f"/matters/{m['id']}").status_code == 404
    assert "secret note" not in client.get("/firm/export").text


# ------------------------------------------------------------------ holidays & reviews

def test_holiday_moves_only_court_acts(client):
    from app.services.deadlines import next_open_day

    sun = date(2026, 12, 6)
    assert next_open_day(sun, set(), "none")[0] == date(2026, 12, 7)
    assert next_open_day(date(2026, 12, 12), set(), "second_fourth")[0] == date(2026, 12, 14)  # 2nd Saturday
    m = client.post("/matters", json={"title": "Holiday v. Test"}).json()
    # notice received 2026-11-05 -> payment window ends 11-20 -> cause of action 11-21 -> complaint by 12-21
    client.post("/holidays", json={"day": "2026-12-21", "name": "Test holiday"})
    r = client.put(f"/matters/{m['id']}/facts", json={"facts": {"notice_received_date": "2026-11-05"}}).json()
    comp = next(d for d in r["deadlines"] if d["rule_id"] == "ni138_complaint_window")
    pay = next(d for d in r["deadlines"] if d["rule_id"] == "ni138_payment_window")
    assert comp["original_due_date"] == "2026-12-21" and comp["due_date"] == "2026-12-22"
    assert "General Clauses Act" in comp["note"]
    assert pay["original_due_date"] is None  # the drawer's payment period is not moved
    r = client.post("/holidays/import", json={"csv": "date,name\n22-12-2026,Second\nbad,line\n"}).json()
    assert r["added"] == 1 and r["bad_lines"] == [3]
    d = client.get(f"/matters/{m['id']}").json()["deadlines"]
    assert next(x for x in d if x["rule_id"] == "ni138_complaint_window")["due_date"] == "2026-12-23"


def test_reviews(client):
    items = client.get("/reviews").json()["items"]
    rule = next(i for i in items if i["kind"] == "rule")
    assert rule["status"] == "unreviewed"
    assert client.post("/reviews", json={"kind": "rule", "ref": rule["ref"], "status": "changes_requested"}).status_code == 422
    assert client.post("/reviews", json={"kind": "rule", "ref": rule["ref"], "status": "approved"}).status_code == 201
    got = next(i for i in client.get("/reviews").json()["items"] if i["ref"] == rule["ref"])
    assert got["status"] == "approved" and got["enrolment"] == "MAH/123/2015"


def test_feedback_and_metrics(client):
    assert client.post("/feedback", json={"kind": "answer", "ref": "q", "rating": -1, "comment": "wrong case"}).status_code == 201
    m = client.get("/metrics").json()
    assert m["feedback"]["down"] >= 1 and m["users"] >= 1 and "weekly_active" in m


# ------------------------------------------------------------------ citator, parallel citations, search

def _store(tmp_path):
    from app.services.citator import analyse
    from app.services.store import Store

    st = Store(tmp_path / "c.db")

    def add(jid, title, own, paras, year=2020):
        refs, pairs = analyse(paras)
        st.add_judgment({"id": jid, "title": title, "court": "Supreme Court of India", "decision_date": f"{year}-01-01",
                         "year": year, "citations": own, "source": "test", "paragraphs": paras, "own_norms": own,
                         "cite_refs": [r for r in refs if r["norm"] not in own], "cite_pairs": pairs})
    add("old", "Old Case v. State", ["2001 INSC 5"],
        [{"no": 1, "text": "The cheque was returned unpaid and the accused failed to pay within the time allowed."}], 2001)
    add("mid", "Middle Ltd v. Union", ["2010 INSC 9"],
        [{"no": 4, "text": "We have followed Old Case v. State, 2001 INSC 5 : AIR 2001 SC 777, on the presumption."}], 2010)
    add("new", "New Bank v. Debtor", ["2020 INSC 1"],
        [{"no": 9, "text": "The view in AIR 2001 SC 777 is not good law and stands overruled to that extent."}], 2020)
    return st


def test_citator_treatment_and_parallel_citations(tmp_path):
    st = _store(tmp_path)
    assert st.by_citation("AIR 2001 SC 777") is None
    assert st.resolve_parallel() >= 1
    assert st.by_citation("AIR 2001 SC 777") == "old"  # learned from "2001 INSC 5 : AIR 2001 SC 777"
    links = st.links("old")
    tr = {g["id"]: g["treatment"] for g in links["cited_by"]}
    assert tr == {"new": "negative", "mid": "positive"}
    assert links["cited_by"][0]["id"] == "new" and links["cited_by"][0]["paras"] == [9]
    assert st.treatment_summary(["old"])["old"]["negative"] == 1
    st.reindex_citator()
    assert st.links("old")["treatment"]["negative"] == 1


def test_synonyms_find_bounce_as_returned_unpaid(tmp_path):
    st = _store(tmp_path)
    assert st.search("cheque bounce")["total"] >= 1
    assert st.search("check dishonour")["results"][0]["id"] == "old"


def test_hybrid_semantic_fusion(tmp_path):
    pytest.importorskip("numpy")
    from app.services import vectors

    class Fake(vectors.Embedder):
        def embed(self, texts):
            return [[1.0 if "overrul" in t.lower() or "bad precedent" in t.lower() else 0.0,
                     1.0 if "cheque" in t.lower() else 0.0, 0.1] for t in texts]
    st = _store(tmp_path)
    vectors.set_embedder(Fake())
    try:
        assert vectors.build(st, progress=lambda s: None) == 3
        r = st.search("bad precedent")  # no keyword overlap with the paragraph text
        assert r["total"] >= 1 and r["results"][0]["id"] == "new" and r["match"] == "semantic"
        assert vectors.status(st)["ready"]
    finally:
        vectors.set_embedder(None)
        vectors._model = False


def test_search_results_flag_negative_treatment(tmp_path):
    st = _store(tmp_path)
    st.resolve_parallel()
    r = st.search("cheque returned unpaid")
    assert r["results"][0]["treatment"]["negative"] == 1


# ------------------------------------------------------------------ external services (mocked)

def test_indiankanoon_lookup(monkeypatch):
    from app.services import indiankanoon as ik

    monkeypatch.setattr(ik, "INDIANKANOON_TOKEN", "tok")

    def handler(req):
        assert req.headers["authorization"] == "Token tok" and req.url.path == "/search/"
        return httpx.Response(200, json={"docs": [{"tid": 42, "title": "<b>Rangappa</b> v. Sri Mohan", "docsource": "Supreme Court"}]})
    r = ik.lookup("(2010) 11 SCC 441", "Rangappa v. Sri Mohan", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert r["tid"] == 42 and r["title"] == "Rangappa v. Sri Mohan" and r["url"].endswith("/doc/42/")


def test_ecourts_parse_and_sync(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Matter, Task
    from app.routes.integrations import sync_matter
    from app.services import ecourts

    monkeypatch.setattr(ecourts, "ECOURTSINDIA_TOKEN", "eci_live_x")
    payload = {"data": {"courtCaseData": {"caseStatus": "Pending", "nextHearingDate": "2026-12-15",
                                          "files": {"files": [{"markdownContent": "Order dated 01.11.2026. Accused "
                                                               "absent. Issue fresh summons. Put up on 15.12.2026."}]}}}}

    def handler(req):
        assert req.headers["authorization"] == "Bearer eci_live_x"
        return httpx.Response(200, json=payload)
    info = ecourts.parse_case(payload)
    assert info["next_date"] == date(2026, 12, 15) and info["status"] == "Pending" and len(info["orders"]) == 1
    m = client.post("/matters", json={"title": "Sync v. Test", "cnr": "MHPU010012342024"}).json()
    c = httpx.Client(transport=httpx.MockTransport(handler))
    with SessionLocal() as db:
        mm = db.get(Matter, m["id"])
        r = sync_matter(db, mm, client=c)
        assert r["new_orders"] == 1 and r["proposed_tasks"] >= 1
        assert sync_matter(db, mm, client=c)["new_orders"] == 0  # same order is not read twice
        assert db.query(Task).filter(Task.matter_id == m["id"], Task.action == "set_next_date").count() == 1
    assert client.post(f"/matters/{m['id']}/sync").status_code in (422, 502)  # real network not used in tests
    assert not ecourts.valid_cnr("123")


def test_whatsapp_order_intake(client, monkeypatch):
    from app.db import SessionLocal
    from app.services import whatsapp as wa

    monkeypatch.setattr(wa, "WA_TOKEN", "t")
    monkeypatch.setattr(wa, "WA_PHONE_ID", "p")
    client.patch("/auth/me", json={"phone": "+91 98765 43210"})
    m = client.post("/matters", json={"title": "WA v. Test", "case_number": "SCC/77/2026"}).json()
    sent = []
    order = b"Order dated 02.11.2026. Complainant present. Issue notice to accused. Put up on 10.12.2026."

    def handler(req):
        if req.url.path.endswith("/messages"):
            sent.append(json.loads(req.content))
            return httpx.Response(200, json={"messages": [{"id": f"out{len(sent)}"}]})
        if req.url.path.endswith("/media1"):
            return httpx.Response(200, json={"url": "https://lookaside.example/m1", "mime_type": "text/plain"})
        return httpx.Response(200, content=order)
    c = httpx.Client(transport=httpx.MockTransport(handler))
    msg = {"id": "wamid.1", "from": "919876543210", "type": "document",
           "document": {"id": "media1", "filename": "order.txt", "caption": "SCC/77/2026"}}
    with SessionLocal() as db:
        reply = wa.handle_message(db, msg, client=c)
        assert "10 Dec 2026" in reply and f"/m/{m['id']}/tasks" in reply
        assert wa.handle_message(db, msg, client=c) is None  # retried delivery is ignored
        r2 = wa.handle_message(db, {"id": "wamid.2", "from": "919999999999", "type": "text", "text": {"body": "brief"}}, client=c)
        assert "not registered" in r2
        r3 = wa.handle_message(db, {"id": "wamid.3", "from": "919876543210", "type": "text", "text": {"body": "brief"}}, client=c)
        assert "Morning brief" in r3
    assert len(sent) == 3
    assert client.get(f"/matters/{m['id']}").json()["orders"][0]["source"] == "whatsapp"


def test_whatsapp_signature(monkeypatch):
    import hashlib
    import hmac

    from app.services import whatsapp as wa

    monkeypatch.setattr(wa, "WA_APP_SECRET", "s3cret")
    body = b'{"entry":[]}'
    good = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert wa.verify_signature(body, good) and not wa.verify_signature(body, "sha256=00")


def test_scanned_order_uses_ai_transcription(client):
    class Scan(Recorder):
        def transcribe(self, data, media_type, model=None):
            assert media_type == "image/png"
            return "आदेश दिनांक 03.11.2026. Order dated 03.11.2026. Put up on 18.12.2026 for appearance of accused."
    llm_mod.set_llm(Scan())
    m = client.post("/matters", json={"title": "Scan v. Test"}).json()
    r = client.post(f"/matters/{m['id']}/orders", files={"file": ("order.png", b"\x89PNG not really text", "image/png")})
    assert r.status_code == 201, r.text
    o = r.json()["order"]
    assert o["next_date"] == "2026-12-18" and o["extraction_method"].startswith("ai-transcription")
    assert "AI transcription" in o["needs_review"][0]


def test_answer_cache(client):
    rec = Recorder()
    llm_mod.set_llm(rec)
    q = {"question": "When must the demand notice be issued after dishonour?"}
    a = client.post("/research/ask", json=q).json()
    n = len(rec.seen)
    b = client.post("/research/ask", json=q).json()
    if a.get("mode") == "answer":
        assert b.get("cached") and len(rec.seen) == n


def test_backup_job(tmp_path, monkeypatch):
    from app import jobs

    monkeypatch.setattr(jobs, "BACKUP_DIR", str(tmp_path / "b"))
    made = jobs.job_backup()
    assert made and all(p.endswith((".db", ".dump")) for p in made)
    assert all(str(tmp_path / "b") in p for p in made)
