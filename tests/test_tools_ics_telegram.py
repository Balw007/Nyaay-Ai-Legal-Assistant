from datetime import date, datetime, timezone

import httpx
import pytest

from app.services import converter, ics
from app.services import telegram as tg

# ---------------------------------------------------------------- converter


def test_converter_both_directions_and_sources():
    r = converter.lookup("302 IPC")
    assert r["results"] and r["results"][0]["new"]["code"] == "BNS" and r["results"][0]["source"]
    back = converter.lookup("103 BNS")
    assert any(x["old"]["section"] == "302" for x in back["results"])
    assert all(x["source"] for x in converter.table()["mappings"])


def test_converter_unknown_and_ni_act_untouched():
    r = converter.lookup("999999 IPC")
    assert r["results"] == [] and r["message"]
    assert "138" not in {m["old"] for m in converter.table()["mappings"] if m["old_act"] == "NI"}
    assert converter.lookup("138 NI Act")["unchanged"]


def test_converter_api(client):
    r = client.get("/tools/convert", params={"q": "438 CrPC"})
    assert r.status_code == 200 and r.json()["results"] and r.json()["notice"]
    assert client.get("/tools/convert/table", params={"act": "ipc"}).status_code == 200


def test_converter_needs_login(anon):
    assert anon.get("/tools/convert", params={"q": "302 IPC"}).status_code in (401, 403)

# ---------------------------------------------------------------- ics


def test_ics_escape_and_fold():
    assert ics._esc("a,b;c\nd\\") == "a\\,b\\;c\\nd\\\\"
    text = ics.render([{"uid": "x@nyaay", "date": date(2026, 12, 1), "summary": "Hearing " + "long " * 40,
                        "description": "d", "categories": "Hearing", "alarms": [1]}], "Test")
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))
    assert "DTSTART;VALUE=DATE:20261201" in text


def _matter(client):
    m = client.post("/matters", json={"title": "A v. B", "client_name": "Mr T"}).json()
    client.put(f"/matters/{m['id']}/facts", json={"facts": {"cheque_date": "2026-12-01",
                                                          "bank_information_received_date": "2026-12-10"}})
    client.patch(f"/matters/{m['id']}", json={"next_date": "2027-01-15"})
    return m


def test_ics_endpoints_and_feed_token(client):
    m = _matter(client)
    r = client.get("/calendar.ics")
    assert r.headers["content-type"].startswith("text/calendar") and "BEGIN:VEVENT" in r.text
    one = client.get(f"/matters/{m['id']}/calendar.ics", params={"download": "true"})
    assert "attachment" in one.headers["content-disposition"]
    feed = client.post("/calendar/feed").json()
    token = feed["url"].split("token=")[1]
    client.cookies.clear()
    assert client.get("/calendar.ics").status_code in (401, 403)
    assert client.get("/calendar.ics", params={"token": token}).status_code == 200
    assert client.get("/calendar.ics", params={"token": "wrong"}).status_code == 401

# ---------------------------------------------------------------- telegram


def _mock(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_telegram_send_splits_and_reports_errors():
    sent = []

    def ok(req):
        sent.append(req.read())
        return httpx.Response(200, json={"ok": True, "result": {}})

    tg.send_message("123456789:" + "A" * 35, "424242", "x" * 5000, client=_mock(ok))
    assert len(sent) == 2

    def bad(req):
        return httpx.Response(400, json={"ok": False, "description": "Bad Request: chat not found"})

    with pytest.raises(tg.TelegramError) as e:
        tg.send_message("123456789:" + "A" * 35, "424242", "hi", client=_mock(bad))
    assert "Start" in str(e.value) and "123456789" not in str(e.value)


def test_recent_chats_private_only():
    def h(req):
        return httpx.Response(200, json={"ok": True, "result": [
            {"message": {"chat": {"id": 7, "type": "private", "first_name": "Varad"}}},
            {"message": {"chat": {"id": -9, "type": "group", "title": "g"}}}]})

    assert tg.recent_chats("123456789:" + "A" * 35, client=_mock(h)) == [{"id": "7", "name": "Varad", "username": None}]


def test_token_never_returned_and_validated(client, monkeypatch):
    assert client.put("/integrations/telegram", json={"bot_token": "nope"}).status_code == 422
    token = "123456789:" + "A" * 35
    monkeypatch.setattr(tg, "get_me", lambda t, client=None: {"username": "nyaay_bot"})
    r = client.put("/integrations/telegram", json={"bot_token": token})
    assert r.status_code == 200 and r.json()["bot_username"] == "nyaay_bot" and token not in r.text
    assert token not in client.get("/firm").text


def test_brief_delivery_once_per_day(client, monkeypatch):
    from app.db import SessionLocal
    from app.models import Firm, User
    from app.services import brief_delivery as bd

    token = "123456789:" + "A" * 35
    calls = []

    def ok(req):
        calls.append(1)
        return httpx.Response(200, json={"ok": True, "result": {}})

    with SessionLocal() as db:
        f = db.query(Firm).first()
        f.settings = {**(f.settings or {}), "telegram_bot_token": token}
        u = db.query(User).first()
        u.telegram_chat_id, u.telegram_brief, u.last_brief_on = "424242", True, None
        db.commit()
        at8 = datetime(2026, 12, 1, 2, 30, tzinfo=timezone.utc)  # 08:00 IST
        assert bd.deliver_due(db, now=datetime(2026, 12, 1, 0, 0, tzinfo=timezone.utc), tg_client=_mock(ok)) == 0  # 05:30 IST
        assert bd.deliver_due(db, now=at8, tg_client=_mock(ok)) == 1
        assert bd.deliver_due(db, now=at8, tg_client=_mock(ok)) == 0
        assert len(calls) >= 1
