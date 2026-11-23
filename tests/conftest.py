import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_tmp = tempfile.mkdtemp()
# Tests run on SQLite by default. Set NYAAY_TEST_DATABASE_URL to a throw-away PostgreSQL database to run the same
# suite on Postgres (its tables are dropped and rebuilt at the start of the run).
_pg = os.environ.get("NYAAY_TEST_DATABASE_URL")
os.environ["NYAAI_DATABASE_URL"] = _pg or f"sqlite:///{_tmp}/test.db"
if _pg and not os.environ.get("_NYAAY_PG_RESET"):  # once per run, even if this file is imported twice
    os.environ["_NYAAY_PG_RESET"] = "1"
    from sqlalchemy import create_engine, text

    with create_engine(_pg).begin() as _c:
        _c.execute(text("DROP SCHEMA public CASCADE"))
        _c.execute(text("CREATE SCHEMA public"))
os.environ["NYAAI_CORPUS"] = f"{_tmp}/corpus.db"  # never touch the real judgment library
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ["NYAAI_LLM"] = "none"     # tests inject fake models; never call a real one
os.environ["NYAAI_EMBED"] = "none"
os.environ["NYAAY_SCHEDULER"] = "0"  # no background brief sender during tests
os.environ.setdefault("NYAAI_DEMO", "1")  # tests use the 3 fictional fixture judgments

import pytest  # noqa: E402


PASSWORD = "correct horse battery"


def signed_in(c, email="owner@firm.test"):
    """Set up the installation on first use, then sign in."""
    c.headers.update({"X-Requested-With": "nyaai"})
    if not c.get("/auth/status").json()["has_users"]:
        r = c.post("/auth/setup", json={"firm_name": "Test Chambers", "name": "Test Owner", "email": email,
                                        "password": PASSWORD, "enrolment_no": "MAH/123/2015", "demo": False})
        assert r.status_code == 201, r.text
    else:
        r = c.post("/auth/login", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
    return c


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield signed_in(c)


@pytest.fixture()
def anon():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        c.headers.update({"X-Requested-With": "nyaai"})
        yield c


@pytest.fixture(autouse=True)
def reset_llm():
    from app.services import llm

    llm.set_llm(None)
    yield
    llm.set_llm(None)
