from datetime import date, timedelta

from app.services import hearing_notes as hn
from app.services import llm


def _m(client, **kw):
    return client.post("/matters", json={"title": "Sample Finance v. Demo Traders", "client_name": "Mr Test",
                                         "court": "Fictional Court", **kw}).json()


class Fake(llm.LLM):
    available = True
    name = "fake"

    def __init__(self, out):
        self.out = out

    def json(self, system, user, max_tokens=1500, model=None):
        return self.out


# ---------------------------------------------------------------- opposing side

def test_opposing_check_retrieval_only_offline(client):
    m = _m(client)
    client.post("/bookmarks", json={"jid": "fx-001", "matter_id": m["id"]})
    r = client.post(f"/matters/{m['id']}/opposing-check", json={"position": "cheque dishonoured notice within thirty days"})
    assert r.status_code == 200
    j = r.json()
    assert j["mode"] == "retrieval_only" and j["answer"] is None and j["message"]
    assert j["saved_authorities"] == 1 and isinstance(j["contrary_sources"], list)
    assert all(s["jid"] != "fx-001" for s in j["contrary_sources"])


def test_opposing_check_ai_markers_verified(client):
    m = _m(client)
    llm.set_llm(Fake({"answer": "The other side may argue the notice was late [S1]. Also [S99].", "limitations": ""}))
    j = client.post(f"/matters/{m['id']}/opposing-check", json={"position": "cheque notice thirty days"}).json()
    if j["contrary_sources"]:
        assert j["mode"] == "answer" and "[S99]" not in j["answer"] and j["checks"]["invalid_markers_removed"] == [99]


def test_opposing_check_404_other_firm(client):
    assert client.post("/matters/9999/opposing-check", json={"position": "x"}).status_code == 404

# ---------------------------------------------------------------- client updates


def test_client_update_languages_and_approval_flow(client):
    m = _m(client)
    nd = date.today() + timedelta(days=10)
    client.patch(f"/matters/{m['id']}", json={"next_date": nd.isoformat()})
    assert client.post(f"/matters/{m['id']}/client-update", json={"language": "fr"}).status_code == 422
    msgs = {}
    for lang in ("en", "hi", "mr"):
        r = client.post(f"/matters/{m['id']}/client-update", json={"language": lang, "note": "Please bring your ID."})
        assert r.status_code == 201
        t = r.json()
        assert t["status"] == "proposed" and t["action"] == "client_update" and str(nd.year) in t["detail"]
        msgs[lang] = t
    assert "Dear Mr Test" in msgs["en"]["detail"] and "प्रिय" in msgs["hi"]["detail"] and "रोजी" in msgs["mr"]["detail"]
    t = msgs["en"]
    assert client.get(f"/tasks/{t['id']}/share").status_code == 409  # not approved yet: never shareable
    e = client.patch(f"/tasks/{t['id']}", json={"detail": "Dear Mr Test, edited."}).json()
    assert e["payload"]["message"] == "Dear Mr Test, edited."
    assert client.post(f"/tasks/{t['id']}/approve").status_code == 200
    s = client.get(f"/tasks/{t['id']}/share").json()
    assert s["whatsapp_url"].startswith("https://wa.me/?text=") and "edited" in s["message"]
    assert client.patch(f"/tasks/{t['id']}", json={"detail": "x"}).status_code == 409
    assert client.post(f"/tasks/{t['id']}/done").json()["status"] == "done"
    assert client.get(f"/matters/{m['id']}").json()["matter"]["next_date"] == nd.isoformat()  # untouched

# ---------------------------------------------------------------- hearing notes


NOTES = """Accused appeared. Court directed the complainant to file the list of witnesses.
Need to collect the original bank return memo from the client.
Next date of hearing is 25/05/2027 for evidence."""


def test_hearing_notes_rules_make_proposed_tasks(client):
    m = _m(client)
    r = client.post(f"/matters/{m['id']}/hearing-notes", json={"text": NOTES, "hearing_date": "2027-04-01"})
    assert r.status_code == 201
    j = r.json()
    assert j["method"] == "rules" and j["tasks"] and all(t["status"] == "proposed" for t in j["tasks"])
    assert all(t["source"] == "hearing_note" for t in j["tasks"])
    nd = [t for t in j["tasks"] if t["action"] == "set_next_date"]
    assert nd and nd[0]["payload"]["date"] == "2027-05-25"
    assert client.get(f"/matters/{m['id']}").json()["matter"]["next_date"] != "2027-05-25"  # not applied yet
    assert any("Hearing note" in n["body"] for n in client.get(f"/matters/{m['id']}/notes").json())
    again = client.post(f"/matters/{m['id']}/hearing-notes", json={"text": NOTES}).json()
    assert again["tasks"] == [] or all(t["title"] not in {x["title"] for x in j["tasks"]} for t in again["tasks"])
    assert client.post(f"/matters/{m['id']}/hearing-notes", json={"text": "hi"}).status_code == 422


def test_hearing_notes_ai_cannot_invent_dates():
    text = "File reply by 10/06/2027. Collect the cheque."
    ai = Fake({"tasks": [{"title": "File reply", "due_date": "2027-06-10"},
                         {"title": "Collect cheque", "due_date": "2031-01-01"}]})
    res = hn.extract(text, None, ai)
    due = {t["title"]: t["due_date"] for t in res["tasks"]}
    assert res["method"] == "ai" and due["File reply"] == date(2027, 6, 10) and due["Collect cheque"] is None
    assert res["needs_review"]

# ---------------------------------------------------------------- approvals queue


def test_queue_batch_and_log(client):
    m = _m(client)
    a = client.post(f"/matters/{m['id']}/hearing-notes", json={"text": NOTES}).json()["tasks"]
    todo = [t["id"] for t in a if t["action"] is None]
    q = client.get("/approvals/queue", params={"matter_id": m["id"]}).json()
    assert q["total"] == len(a) and "waiting across 1 matter" in q["summary"]
    assert set(q["safe_ids"]) == set(todo) and q["groups"][0]["matter"]["id"] == m["id"]
    r = client.post("/tasks/batch", json={"ids": todo, "decision": "approve"}).json()
    assert len(r["done"]) == len(todo) and not r["skipped"]
    again = client.post("/tasks/batch", json={"ids": todo[:1], "decision": "reject"}).json()
    assert again["skipped"] and "already" in again["skipped"][0]["reason"]
    log = client.get("/approvals/log").json()
    assert any(x["action"] == "batch_approve" for x in log) and any(x["title"] for x in log)
    assert client.post("/tasks/batch", json={"ids": [], "decision": "approve"}).status_code == 422
    assert client.post("/tasks/batch", json={"ids": [1], "decision": "maybe"}).status_code == 422


def test_batch_skips_conflicting_date_changes(client):
    m = _m(client)
    ids = []
    for d in ("2027-05-01", "2027-06-01"):
        ids.append(client.post(f"/matters/{m['id']}/hearing-notes",
                               json={"text": f"Next date of hearing is {d[8:]}/{d[5:7]}/{d[:4]} for evidence."}
                               ).json()["tasks"][0]["id"])
    q = client.get("/approvals/queue").json()["groups"][0]["tasks"]
    assert all(t["conflict"] for t in q if t["action"] == "set_next_date")
    r = client.post("/tasks/batch", json={"ids": ids, "decision": "approve"}).json()
    assert not r["done"] and len(r["skipped"]) == 2
    assert client.get(f"/matters/{m['id']}").json()["matter"]["next_date"] is None
    assert client.post(f"/tasks/{ids[0]}/approve").status_code == 200  # one at a time still works

# ---------------------------------------------------------------- routes


def test_routes_what_if_and_draft_until_signed_off(client):
    m = _m(client)
    client.put(f"/matters/{m['id']}/facts", json={"facts": {"cheque_date": "2026-12-01",
                                                          "bank_information_received_date": "2026-12-10"}})
    j = client.get(f"/matters/{m['id']}/routes").json()
    assert {r["id"] for r in j["routes"]} >= {"notice_then_complaint", "civil_recovery"}
    assert all(r["draft"] for r in j["routes"])
    first = next(r for r in j["routes"] if r["id"] == "notice_then_complaint")
    cw = next(d for d in first["deadlines"] if d["rule_id"] == "ni138_complaint_window")
    assert cw["due_date"] is None  # needs the notice date
    w = client.get(f"/matters/{m['id']}/routes", params={"notice_received_date": "2026-12-20"}).json()
    cw2 = next(d for r in w["routes"] if r["id"] == "notice_then_complaint" for d in r["deadlines"]
               if d["rule_id"] == "ni138_complaint_window")
    assert cw2["due_date"] == "2027-02-05" and cw2["changed_by_what_if"]  # +15d = 4 Jan, cause of action 5 Jan, +1 month = 5 Feb
    assert client.get(f"/matters/{m['id']}").json()["matter"]["facts"].get("notice_received_date") is None  # not saved
    assert client.get(f"/matters/{m['id']}/routes", params={"notice_received_date": "x"}).status_code == 422
    g = client.put(f"/matters/{m['id']}/goal", json={"route_id": "notice_then_complaint"}).json()
    assert g["draft"] is True and client.get(f"/matters/{m['id']}").json()["matter"]["goal"].startswith("Demand notice")
    assert client.put(f"/matters/{m['id']}/goal", json={"route_id": "nope"}).status_code == 404
    assert client.post("/reviews", json={"kind": "route", "ref": "notice_then_complaint", "status": "approved"}).status_code == 201
    assert client.put(f"/matters/{m['id']}/goal", json={"route_id": "notice_then_complaint"}).json()["draft"] is False
    assert client.put(f"/matters/{m['id']}/goal", json={"goal": "Settle quickly"}).json()["route_id"] is None


def test_add_test_case_is_labelled_removable_and_computes_deadlines(client):
    r = client.post("/firm/add-test-case")
    assert r.status_code == 201 and r.json()["created"] is True
    mid = r.json()["matter_id"]
    again = client.post("/firm/add-test-case")
    assert again.json() == {"matter_id": mid, "created": False}
    d = client.get(f"/matters/{mid}").json()
    assert d["matter"]["title"].endswith("(Demo)")
    dues = {x["rule_id"]: x["due_date"] for x in d["deadlines"]}
    assert dues["ni138_notice_window"] == "2026-10-18" and dues["ni138_payment_window"] == "2026-10-21"
    assert dues["ni138_presentation_validity"] == "2026-11-10" and dues["ni138_complaint_window"] == "2026-11-23"
    assert any(t["status"] == "proposed" for t in d["tasks"])
    gone = client.post("/firm/remove-example-data")
    assert gone.status_code == 200
    assert all(m["id"] != mid for m in client.get("/matters").json())
    from app.services.store import get_store, seed_demo
    seed_demo(get_store())  # later tests use the fixture judgments
