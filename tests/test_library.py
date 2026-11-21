"""Library jobs: upload real judgment files, chunked loading, stop, one job at a time."""
import time

from app import ingest as ing
from app.routes import library


def _wait(c, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        j = c.get("/library/status").json()["job"]
        if j["state"] != "running":
            return j
        time.sleep(0.1)
    raise AssertionError("job did not finish")


TEXT = """IN THE HIGH COURT OF JUDICATURE AT BOMBAY
CRIMINAL APPLICATION NO. 1 OF 2024
Uploadtest Traders v. Example Person
Decided on 12 March 2024

1. The applicant challenges the order of the learned Magistrate taking cognizance of a complaint under Section 138 of the Negotiable Instruments Act, 1881, on the ground that the statutory notice was issued after thirty days.

2. The bank memo shows the cheque was returned on 2 January 2024 and the zebrafinch notice was dispatched on 25 January 2024, within thirty days of the information received from the bank.

3. Learned counsel for the applicant relied on the decision of the Supreme Court holding that the period of thirty days must be computed from the date of receipt of information from the bank, and not from the date of return of the cheque to the bank. The submission does not assist the applicant on the facts of this case, because even on the applicant's own computation the notice was issued within time.

4. The application is therefore without merit and is dismissed. No order as to costs.
"""


def test_upload_own_judgment_is_searchable(client):
    r = client.post("/library/upload", files=[("files", ("uploadtest.txt", TEXT.encode(), "text/plain"))])
    assert r.status_code == 202, r.text
    j = _wait(client)
    assert j["state"] == "done" and j["added"] == 1, j
    hits = client.get("/research/search", params={"q": "zebrafinch notice"}).json()
    assert hits["total"] >= 1


def test_chunked_sc_load_and_single_job(client, monkeypatch):
    calls = []

    def fake_year(store, y, limit=None, workers=4, progress=print):
        calls.append((y, limit))
        time.sleep(0.05)
        return {"added": 2, "failed": 0, "scanned_or_empty": 0} if len([c for c in calls if c[0] == y]) < 3 \
            else {"added": 0, "failed": 0, "scanned_or_empty": 0}

    monkeypatch.setattr(ing, "ingest_year", fake_year)
    r = client.post("/library/load", json={"source": "sc", "years": [2024, 2023]})
    assert r.status_code == 202
    assert client.post("/library/load", json={"source": "sc", "years": [2022]}).status_code == 409
    j = _wait(client)
    assert j["state"] == "done" and j["added"] == 8
    assert all(lim == library.CHUNK for _, lim in calls)
    assert [y for y, _ in calls][:3] == [2024, 2024, 2024]


def test_stop_between_chunks(client, monkeypatch):
    def slow_year(store, y, limit=None, workers=4, progress=print):
        time.sleep(0.2)
        return {"added": 1, "failed": 0, "scanned_or_empty": 0}

    monkeypatch.setattr(ing, "ingest_year", slow_year)
    client.post("/library/load", json={"source": "sc", "years": [2024]})
    time.sleep(0.05)
    client.post("/library/stop")
    j = _wait(client)
    assert j["state"] == "stopped" and j["added"] <= 2


def test_network_failure_is_explained(client, monkeypatch):
    def broken(*a, **k):
        raise ing.FetchError("HTTP 403 for https://example")

    monkeypatch.setattr(ing, "ingest_year", broken)
    client.post("/library/load", json={"source": "sc", "years": [2024]})
    j = _wait(client)
    assert j["state"] == "failed" and "internet" in j["error"]


def test_status_shape(client):
    s = client.get("/library/status").json()
    assert {"corpus", "job", "ai", "semantic"} <= set(s)


def test_remove_example_data(client):
    client.post("/demo/seed")
    s = client.get("/library/status").json()["example_data"]
    assert s["matters"] >= 1
    r = client.post("/firm/remove-example-data").json()
    assert r["removed_matters"] == s["matters"]
    assert client.get("/library/status").json()["example_data"] == {"matters": 0, "judgments": 0}
    assert all("(Demo)" not in m["title"] for m in client.get("/matters").json())
    from app.services.store import get_store, seed_demo
    seed_demo(get_store())  # later tests use the fixture judgments
