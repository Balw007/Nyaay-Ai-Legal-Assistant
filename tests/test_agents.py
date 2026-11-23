"""Agents run real Nyaay services in the background and record what they did. Without an AI they must say so,
never pretend success."""
from fastapi.testclient import TestClient

from app.main import app
from app.services import agents as ag
from tests.conftest import signed_in


def _start(c, agent, data):
    r = c.post("/agents/tasks", json={"agent": agent, "input": data})
    assert r.status_code == 202, r.text
    t = r.json()
    ag.wait(t["id"])
    return c.get(f"/agents/tasks/{t['id']}").json()


def test_catalog_reports_ai_state():
    with TestClient(app) as c:
        signed_in(c)
        cat = {a["id"]: a for a in c.get("/agents").json()}
        assert set(cat) == {"research", "judgment", "citation", "drafting"}
        assert cat["research"]["mode"] == "reduced" and cat["research"]["available"]
        assert cat["drafting"]["mode"] == "unavailable" and not cat["drafting"]["available"]


def test_research_agent_without_ai_returns_paragraphs_and_records_steps():
    with TestClient(app) as c:
        signed_in(c)
        t = _start(c, "research", {"question": "when does the cause of action arise for a cheque complaint"})
        assert t["status"] == "done" and t["progress"] == 100 and not t["indeterminate"]
        assert t["result"]["mode"] in ("retrieval_only", "no_sources")
        assert t["result"]["answer"] is None  # no AI: no invented answer
        texts = [s["text"] for s in t["steps"]]
        assert texts[0] == "Queued" and any("Searching your library" in x for x in texts)


def test_judgment_agent_fails_honestly_without_ai():
    with TestClient(app) as c:
        signed_in(c)
        t = _start(c, "judgment", {"jid": "fx-001"})
        assert t["status"] == "failed" and "Ollama" in t["error"]


def test_citation_agent_saves_a_check_and_reports_progress():
    with TestClient(app) as c:
        signed_in(c)
        text = "As held in Sample Finance Ltd v. Demo Traders, (2099) 1 SCC 100, notice is required."
        t = _start(c, "citation", {"text": text})
        assert t["status"] == "done", t
        assert t["result"]["summary"]["total"] == 1
        assert t["result"]["statuses"][0]["status"] != "VERIFIED"  # never verified without the AI
        assert any("Checking 1 of 1" in s["text"] for s in t["steps"])
        assert c.get(f"/citations/{t['result']['check_id']}").status_code == 200


def test_validation_and_cancel_and_isolation():
    with TestClient(app) as c:
        signed_in(c)
        assert c.post("/agents/tasks", json={"agent": "research", "input": {"question": "hi"}}).status_code == 422
        assert c.post("/agents/tasks", json={"agent": "nope", "input": {}}).status_code == 422
        assert c.post("/agents/tasks", json={"agent": "judgment", "input": {"jid": "missing"}}).status_code == 422
        t = _start(c, "research", {"question": "demand notice within thirty days"})
        assert c.post(f"/agents/tasks/{t['id']}/cancel").status_code == 409  # already finished
        assert any(x["id"] == t["id"] for x in c.get("/agents/tasks").json())
        assert c.get("/agents/tasks?status=active").json() == [] or all(
            x["status"] in ("queued", "running") for x in c.get("/agents/tasks?status=active").json())
        assert c.get("/agents/tasks/999999").status_code == 404
