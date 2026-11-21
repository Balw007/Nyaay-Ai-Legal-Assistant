"""End-to-end flow through the HTTP API, in rules-only mode (no LLM)."""
from datetime import date

ORDER = """ORDER dated 12/03/2026 (FICTIONAL TEST ORDER)
Complaint Case No. 123/2026 - Sample Finance Ltd v. Demo Traders
Accused appeared through counsel and furnished bail bond with one surety. Bail bond is accepted.
The accused is directed to appear on every date of hearing. The complainant shall file the list of witnesses.
The matter is adjourned to 25/04/2026 for framing of notice of accusation.
"""


def make_matter(client, **kw):
    r = client.post("/matters", json={"title": "Sample Finance Ltd v. Demo Traders", "client_name": "Mr Test",
                                      "court": "Fictional Magistrate Court", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_health_is_honest_about_fixture_and_no_llm(client):
    h = client.get("/health").json()
    assert h["index_is_fixture"] is True and h["llm"] == "none"


def test_deadlines_from_confirmed_facts(client):
    m = make_matter(client)
    r = client.put(f"/matters/{m['id']}/facts", json={"facts": {
        "cheque_date": "2026-01-10", "bank_information_received_date": "2026-02-01",
        "notice_received_date": "2026-02-20"}})
    assert r.status_code == 200
    due = {d["rule_id"]: d["due_date"] for d in r.json()["deadlines"]}
    assert due["ni138_complaint_window"] == "2026-04-08" and due["ni138_notice_window"] == "2026-03-03"
    assert all(d["needs_confirmation"] for d in r.json()["deadlines"])


def test_unknown_fact_and_unknown_case_type_rejected(client):
    m = make_matter(client)
    assert client.put(f"/matters/{m['id']}/facts", json={"facts": {"made_up": "2026-01-01"}}).status_code == 422
    assert client.post("/matters", json={"title": "x", "case_type": "nope"}).status_code == 422


def test_order_to_approval_to_matter_update_to_brief(client):
    m = make_matter(client)
    r = client.post(f"/matters/{m['id']}/orders", data={"text": ORDER})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["order"]["next_date"] == "2026-04-25"

    # Nothing changed on the matter yet: the AI only proposed.
    assert client.get(f"/matters/{m['id']}").json()["matter"]["next_date"] is None
    tasks = body["proposed_tasks"]
    assert all(t["status"] == "proposed" for t in tasks)
    titles = [t["title"] for t in tasks]
    assert any(t.startswith("Set next hearing date") for t in titles)
    assert "Send client update" in titles

    # Approve the date and the stage change.
    for t in tasks:
        if t["action"] in {"set_next_date", "set_stage"}:
            assert client.post(f"/tasks/{t['id']}/approve", json={"actor": "adv-test"}).status_code == 200
    d = client.get(f"/matters/{m['id']}").json()
    assert d["matter"]["next_date"] == "2026-04-25"
    assert d["matter"]["current_stage"] in {"accused_appears", "plea_evidence"}

    # Rejecting works and double decisions are refused.
    other = next(t for t in tasks if t["action"] is None)
    assert client.post(f"/tasks/{other['id']}/reject", json={}).status_code == 200
    assert client.post(f"/tasks/{other['id']}/approve", json={}).status_code == 409

    # The brief for the hearing day lists the matter.
    brief = client.get("/brief", params={"on": "2026-04-25"}).json()
    assert any(x["matter_id"] == m["id"] for x in brief["listed_today"])
    text = client.get("/brief", params={"on": "2026-04-25", "format": "text"}).text
    assert "Sample Finance" in text


def test_bad_inputs_to_order_upload(client):
    m = make_matter(client)
    assert client.post(f"/matters/{m['id']}/orders", data={}).status_code == 422
    r = client.post(f"/matters/{m['id']}/orders", files={"file": ("x.exe", b"abc")})
    assert r.status_code == 422


def test_firm_isolation(client):
    from fastapi.testclient import TestClient

    from app.db import SessionLocal
    from app.main import app
    from app.models import Firm, User
    from app.services.security import hash_password

    with SessionLocal() as db:
        if not db.get(Firm, 2):
            db.add(Firm(id=2, name="Other Firm"))
            db.add(User(firm_id=2, email="other@else.test", name="Other", password_hash=hash_password("another pass 123"),
                        role="owner"))
            db.commit()
    m = make_matter(client)
    assert client.get(f"/matters/{m['id']}", headers={"X-Firm-Id": "2"}).status_code == 200  # header is ignored
    with TestClient(app) as other:
        other.headers.update({"X-Requested-With": "nyaai"})
        assert other.post("/auth/login", json={"email": "other@else.test", "password": "another pass 123"}).status_code == 200
        assert other.get(f"/matters/{m['id']}").status_code == 404
        assert all(x["id"] != m["id"] for x in other.get("/matters").json())

def test_citation_check_gate_and_advocate_confirmation(client):
    draft = ("In Sample Finance Ltd v. Demo Traders, 2099 INSC 1, the cause of action arises after the fifteen day "
             "period. Relying on Imaginary Corp v. Nobody, 2099 INSC 999, the claim fails.")
    r = client.post("/citations/check", json={"text": draft})
    assert r.status_code == 201
    res = r.json()
    statuses = [i["status"] for i in res["items"]]
    assert statuses == ["EXISTS_UNCHECKED", "NOT_IN_LIBRARY"]   # no LLM, so nothing is VERIFIED
    assert res["summary"]["can_export"] is False

    cid = res["id"]
    for idx in (0, 1):
        res = client.post(f"/citations/{cid}/items/{idx}/confirm", json={"actor": "adv-test"}).json()
    assert res["summary"]["can_export"] is True              # only because an advocate took responsibility
    assert client.get(f"/citations/{cid}").json()["items"][1]["confirmed_by"] == "Test Owner (MAH/123/2015)"  # the signed-in advocate, not a client-supplied name
    assert client.post(f"/citations/{cid}/items/9/confirm", json={}).status_code == 404


def test_citation_check_with_llm_verifies(client):
    from app.services import llm

    class Yes(llm.LLM):
        available = True
        name = "fake"

        def json(self, system, user, max_tokens=1500):
            return {"verdict": "supports", "reason": "ok"}

    llm.set_llm(Yes())
    res = client.post("/citations/check", json={"text": "In Sample Finance Ltd v. Demo Traders, 2099 INSC 1, the "
                                                         "complaint must be filed within one month."}).json()
    assert res["items"][0]["status"] == "VERIFIED" and res["summary"]["can_export"] is True


def test_ui_is_served(client):
    r = client.get("/app/")
    assert r.status_code == 200 and "Nyaay" in r.text and "app.js" in r.text
