from datetime import date, timedelta

from app.services import drafting as dft
from app.services import llm
from app.services import playbook as pbk


def _demo(client):
    client.post("/demo/seed", json={})
    return {m["title"]: m for m in client.get("/matters").json()}


def test_demo_seed_is_idempotent_and_fills_dashboard(client):
    ms = _demo(client)
    assert any("(Demo)" in t for t in ms)
    assert client.post("/demo/seed", json={}).json()["created_matters"] == 0
    d = client.get("/dashboard").json()
    assert d["counts"]["active_matters"] >= 5 and d["counts"]["hearings_today"] >= 1
    demo = [x for x in d["deadlines"] if "(Demo)" in x["matter"]]
    assert demo and all(x["days_left"] >= 0 for x in demo)  # deadlines of stages already passed are not overdue


def test_deadline_met_by_stage():
    pb = pbk.get_playbook("ni138")
    assert pbk.deadline_met(pb, "ni138_notice_window", "complaint")
    assert not pbk.deadline_met(pb, "ni138_notice_window", "demand_notice")
    assert not pbk.deadline_met(pb, "ni138_complaint_window", None)


def test_calendar_and_clients(client):
    _demo(client)
    t = date.today()
    ev = client.get("/calendar", params={"start": (t - timedelta(days=3)).isoformat(),
                                         "end": (t + timedelta(days=40)).isoformat()}).json()["events"]
    assert {"hearing", "deadline"} <= {e["type"] for e in ev}
    assert client.get("/calendar", params={"start": t.isoformat(), "end": (t + timedelta(days=400)).isoformat()}).status_code == 422
    assert any(c["name"] == "Shreeji Agro Traders" and len(c["matters"]) >= 2 for c in client.get("/clients").json())


def test_draft_lifecycle(client):
    ms = _demo(client)
    mid = ms["Kaveri Fertilisers v. Sunrise Agencies (Demo)"]["id"]
    r = client.post("/drafts", json={"template": "ni138_complaint", "matter_id": mid})
    assert r.status_code == 201
    d = r.json()
    assert "Rs. 3,12,750/-" in d["body"] and "Sunrise Agencies" in d["body"]
    assert "[[Date notice was received]]" in d["placeholders"]  # never guessed
    assert client.put(f"/drafts/{d['id']}", json={"status": "final"}).status_code == 409
    body = dft.PH.sub("X", d["body"])
    assert client.put(f"/drafts/{d['id']}", json={"body": body, "status": "final"}).json()["status"] == "final"
    ex = client.get(f"/drafts/{d['id']}/export?format=txt")
    assert ex.status_code == 200 and "attachment" in ex.headers["content-disposition"]
    assert client.post("/drafts", json={"template": "nope"}).status_code == 422
    assert client.post(f"/drafts/{d['id']}/polish").status_code == 409  # no AI configured


def test_polish_rejects_new_facts():
    class Fake:
        available, name = True, "fake"
        def __init__(self, body):
            self.body = body
        def json(self, s, u, max_tokens=0):
            return {"body": self.body, "changes": ["tidied"]}
    src = "Pay Rs. 5,000/- to [[Complainant name]] as held in law."
    ok = dft.polish(src, Fake("Kindly pay Rs. 5,000/- to [[Complainant name]], as settled in law."))
    assert ok["accepted"]
    bad = dft.polish(src, Fake("Pay Rs. 50,000/- to the complainant, see (2019) 5 SCC 418."))
    assert not bad["accepted"] and len(bad["problems"]) == 3


def test_money_formatting():
    assert dft._money("1250000") == "Rs. 12,50,000/-"
    assert dft._money("90000") == "Rs. 90,000/-"
    assert dft._money("500") == "Rs. 500/-"


def test_notes_bookmarks_patch_search(client):
    ms = _demo(client)
    mid = next(iter(ms.values()))["id"]
    n = client.post(f"/matters/{mid}/notes", json={"body": "Call client"}).json()
    assert client.get(f"/matters/{mid}/notes").json()[0]["body"] == "Call client"
    assert client.delete(f"/notes/{n['id']}").status_code == 204
    b = client.post("/bookmarks", json={"jid": "fx-001", "para_no": 1, "matter_id": mid, "note": "key"})
    assert b.status_code == 201 and b.json()["excerpt"]
    assert client.post("/bookmarks", json={"jid": "fx-001", "para_no": 1, "matter_id": mid}).json()["id"] == b.json()["id"]
    assert client.post("/bookmarks", json={"jid": "missing"}).status_code == 404
    assert client.get(f"/bookmarks?matter_id={mid}").json()[0]["jid"] == "fx-001"
    r = client.patch(f"/matters/{mid}", json={"status": "on_hold", "details": {"cheque_no": "42", "evil": "x"}})
    assert r.json()["status"] == "on_hold" and r.json()["details"]["cheque_no"] == "42" and "evil" not in r.json()["details"]
    assert client.patch(f"/matters/{mid}", json={"status": "weird"}).status_code == 422
    s = client.get("/search", params={"q": "Shreeji"}).json()
    assert s["matters"]
    client.get("/research/search", params={"q": "cheque"})
    assert "cheque" in client.get("/dashboard").json()["recent_searches"]
    assert client.get("/activity").json()
