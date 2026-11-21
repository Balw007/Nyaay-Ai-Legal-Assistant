"""Ollama provider: JSON mode, thinking stripped, clear errors, nomic prefixes, offline fallback."""
import json

import httpx

from app.services import llm as llm_mod
from app.services import vectors


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_json_strips_thinking_and_records_usage():
    seen = {}

    def handler(req):
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"content": "<think>hmm</think>{\"answer\": \"ok [1]\"}"},
                                         "prompt_eval_count": 120, "eval_count": 9})

    m = llm_mod.OllamaLLM("qwen3:8b", "qwen3:4b")
    m.http = _client(handler)
    out = m.json("Answer from the paragraphs.", "Q?", max_tokens=200, model="qwen3:4b")
    assert out == {"answer": "ok [1]"}
    assert seen["model"] == "qwen3:4b" and seen["format"] == "json" and seen["think"] is False
    assert seen["options"]["num_predict"] == 200
    assert m.last_usage == (120, 9)


def test_missing_model_message():
    m = llm_mod.OllamaLLM("qwen3:8b", "qwen3:4b")
    m.http = _client(lambda req: httpx.Response(404, json={"error": "model not found"}))
    try:
        m.json("s", "u")
    except RuntimeError as e:
        assert "ollama pull qwen3:8b" in str(e)
    else:
        raise AssertionError("expected a clear error")


def test_old_ollama_without_think_switch_retries():
    calls = []

    def handler(req):
        body = json.loads(req.content)
        calls.append("think" in body)
        if "think" in body:
            return httpx.Response(400, json={"error": "unknown field think"})
        return httpx.Response(200, json={"message": {"content": "{\"x\": 1}"}})

    m = llm_mod.OllamaLLM("qwen3:8b", "qwen3:4b")
    m.http = _client(handler)
    assert m.json("s", "u") == {"x": 1}
    assert calls == [True, False]


def test_transcribe_needs_vision_model():
    m = llm_mod.OllamaLLM("qwen3:8b", "qwen3:4b")
    try:
        m.transcribe(b"x", "image/png")
    except RuntimeError as e:
        assert "OLLAMA_VISION_MODEL" in str(e)


def test_offline_ollama_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(llm_mod, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(llm_mod, "ollama_reachable", lambda timeout=1.5: [])
    llm_mod.set_llm(None)
    assert llm_mod.get_llm().available is False
    assert "not running" in llm_mod.llm_status()["message"]


def test_installed_models_are_used(monkeypatch):
    monkeypatch.setattr(llm_mod, "LLM_PROVIDER", "ollama")
    monkeypatch.setattr(llm_mod, "MODEL", "qwen3:8b")
    monkeypatch.setattr(llm_mod, "MODEL_FAST", "qwen3:4b")
    monkeypatch.setattr(llm_mod, "ollama_reachable", lambda timeout=1.5: ["qwen3:4b"])
    llm_mod.set_llm(None)
    m = llm_mod.get_llm()
    assert m.available and m.name == "ollama"
    assert m.model == "qwen3:4b"  # only the small model is installed, so it does both jobs


def test_nomic_prefixes():
    sent = []

    def handler(req):
        body = json.loads(req.content)
        sent.append(body["input"])
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2]] * len(body["input"])})

    e = vectors.OllamaEmbedder.__new__(vectors.OllamaEmbedder)
    e.name, e.nomic, e.http = "nomic-embed-text", True, _client(handler)
    e.embed(["cheque returned unpaid"])
    e.embed_query("dishonour of cheque")
    assert sent[0] == ["search_document: cheque returned unpaid"]
    assert sent[1] == ["search_query: dishonour of cheque"]


def test_chat_recovers_from_server_error(monkeypatch):
    """A 500 from Ollama is retried (after freeing memory) instead of failing the request."""
    from app.services import llm as L

    calls = []

    class R:
        def __init__(self, code, body):
            self.status_code, self._b, self.text = code, body, str(body)

        def json(self):
            return self._b

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError("http")

    class H:
        def post(self, url, json=None, timeout=None):
            if url.endswith("/api/chat"):
                calls.append(json["model"])
                return R(500, {"error": "model runner stopped"}) if len(calls) < 3 else R(
                    200, {"message": {"content": '{"ok": true}'}, "prompt_eval_count": 1, "eval_count": 1})
            return R(200, {})

        def get(self, url, timeout=None):
            return R(200, {"models": [{"name": "nomic-embed-text:latest"}]})

    monkeypatch.setattr(L.time, "sleep", lambda s: None, raising=False) if hasattr(L, "time") else None
    o = L.OllamaLLM("qwen3:8b", "qwen3:4b")
    o.http = H()
    import time as _t
    monkeypatch.setattr(_t, "sleep", lambda s: None)
    assert o.json("s", "u") == {"ok": True}
    assert len(calls) == 3


def test_chat_reports_ollama_message_when_all_attempts_fail(monkeypatch):
    from app.services import llm as L
    import time as _t

    class R:
        status_code, text = 500, "x"

        def json(self):
            return {"error": "out of memory"}

    class H:
        def post(self, url, json=None, timeout=None):
            return R()

        def get(self, url, timeout=None):
            return type("G", (), {"json": lambda s: {"models": []}})()

    monkeypatch.setattr(_t, "sleep", lambda s: None)
    o = L.OllamaLLM("qwen3:8b", "qwen3:4b")
    o.http = H()
    try:
        o.json("s", "u")
        assert False, "should raise"
    except RuntimeError as e:
        assert "out of memory" in str(e) and "short of memory" in str(e)
