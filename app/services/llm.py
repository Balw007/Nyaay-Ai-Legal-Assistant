"""Thin LLM wrapper. The rest of the code only needs `available` and `json(system, user)`.

Providers: Ollama (local, default), Anthropic (NYAAI_LLM=anthropic). With no model available the app runs in
rules-only mode:
  - orders are read with regex heuristics
  - citations can be found but are never marked VERIFIED automatically
"""
from __future__ import annotations

import json
import re

from ..config import (ANTHROPIC_API_KEY, LLM_PROVIDER, MODEL, MODEL_FAST, OLLAMA_EMBED_MODEL, OLLAMA_NUM_CTX,
                      OLLAMA_TIMEOUT, OLLAMA_URL, OLLAMA_VISION_MODEL)


class LLM:
    available = False
    name = "none"
    model = None
    last_usage = (0, 0)  # (input_tokens, output_tokens) of the most recent call

    def json(self, system: str, user: str, max_tokens: int = 1500, model: str = None) -> dict:  # pragma: no cover
        raise NotImplementedError

    def transcribe(self, data: bytes, media_type: str, model: str = None) -> str:  # pragma: no cover
        """Read a scanned PDF or photo (any Indian language) and return its text."""
        raise NotImplementedError


class NullLLM(LLM):
    pass


def parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in model output")
    return json.loads(text[start:end + 1])


class AnthropicLLM(LLM):
    available = True
    name = "anthropic"

    def __init__(self, api_key: str, model: str):
        import anthropic  # optional dependency

        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model

    def _usage(self, resp) -> None:
        u = getattr(resp, "usage", None)
        self.last_usage = (getattr(u, "input_tokens", 0) or 0, getattr(u, "output_tokens", 0) or 0)

    def json(self, system: str, user: str, max_tokens: int = 1500, model: str = None) -> dict:
        resp = self.client.messages.create(
            model=model or self.model, max_tokens=max_tokens, system=system,
            messages=[{"role": "user", "content": user}],
        )
        self._usage(resp)
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return parse_json(text)

    def transcribe(self, data: bytes, media_type: str, model: str = None) -> str:
        import base64

        kind = "document" if media_type == "application/pdf" else "image"
        block = {"type": kind, "source": {"type": "base64", "media_type": media_type,
                                          "data": base64.b64encode(data).decode()}}
        resp = self.client.messages.create(
            model=model or self.model, max_tokens=8000,
            system=("Transcribe this Indian court document exactly as written, in its original language "
                    "(English, Hindi, Marathi or any other). Keep dates, case numbers and names exactly. "
                    "Output only the text. If a word is illegible write [illegible]."),
            messages=[{"role": "user", "content": [block, {"type": "text", "text": "Transcribe."}]}],
        )
        self._usage(resp)
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


_THINK = re.compile(r"<think>.*?</think>", re.S)


def ollama_reachable(timeout: float = 1.5) -> list:
    """Names of the models installed in the local Ollama, or [] when Ollama is not running."""
    import httpx

    try:
        r = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=timeout)
        r.raise_for_status()
        return [m.get("name", "") for m in r.json().get("models", [])]
    except Exception:
        return []


def _has(installed: list, name: str) -> bool:
    base = name if ":" in name else f"{name}:latest"
    return name in installed or base in installed


class OllamaLLM(LLM):
    """Local models through Ollama (https://ollama.com). Nothing leaves the machine.

    JSON mode is forced, and Qwen3's thinking is switched off so answers come back quickly on a CPU.
    """
    available = True
    name = "ollama"

    def __init__(self, model: str, fast: str, vision: str = "", url: str = OLLAMA_URL):
        import httpx

        self.url, self.model, self.fast, self.vision = url, model, fast, vision
        self.http = httpx.Client(timeout=OLLAMA_TIMEOUT)

    def _post_chat(self, model: str, messages: list, max_tokens: int, json_mode: bool, num_ctx: int):
        body = {"model": model, "messages": messages, "stream": False, "think": False, "keep_alive": "3m",
                "options": {"temperature": 0.1, "num_ctx": num_ctx, "num_predict": max_tokens}}
        if json_mode:
            body["format"] = "json"
        r = self.http.post(f"{self.url}/api/chat", json=body)
        if r.status_code == 400 and "think" in r.text:  # older Ollama without the think switch
            body.pop("think")
            r = self.http.post(f"{self.url}/api/chat", json=body)
        return r

    def _unload_others(self, keep: str) -> None:
        """A 16 GB laptop cannot hold the big model, the small model and the embedder at once: free the others."""
        try:
            for m in self.http.get(f"{self.url}/api/ps", timeout=5).json().get("models", []):
                name = m.get("name") or m.get("model")
                if name and name != keep and name.split(":")[0] != keep.split(":")[0]:
                    self.http.post(f"{self.url}/api/generate", json={"model": name, "keep_alive": 0}, timeout=15)
        except Exception:
            pass

    @staticmethod
    def _ollama_error(r) -> str:
        try:
            return (r.json().get("error") or r.text)[:300]
        except Exception:
            return (r.text or "")[:300]

    def _chat(self, model: str, messages: list, max_tokens: int, json_mode: bool = True) -> str:
        import time

        # Try as asked; on a server error free memory and retry, then use a smaller context, then the lighter model.
        attempts = [(model, OLLAMA_NUM_CTX, False), (model, OLLAMA_NUM_CTX, True), (model, 4096, True)]
        if model == self.model and self.fast and self.fast != model:
            attempts.append((self.fast, 4096, True))
        last = None
        for i, (m, ctx, free) in enumerate(attempts):
            if free:
                self._unload_others(m)
                time.sleep(1.5)
            try:
                r = self._post_chat(m, messages, max_tokens, json_mode, ctx)
            except Exception as exc:  # connection dropped: the model runner can crash under memory pressure
                last = f"Ollama did not respond ({type(exc).__name__})."
                continue
            if r.status_code == 404:
                raise RuntimeError(f"Ollama model '{m}' is not installed. Run: ollama pull {m}")
            if r.status_code >= 500:
                last = self._ollama_error(r)
                continue
            r.raise_for_status()
            data = r.json()
            self.last_usage = (data.get("prompt_eval_count", 0) or 0, data.get("eval_count", 0) or 0)
            return _THINK.sub("", (data.get("message") or {}).get("content", "")).strip()
        raise RuntimeError("Ollama could not run the model, usually because the computer is short of memory. "
                           "Close other programs, quit and reopen Ollama, then try again. "
                           f"Ollama said: {last}")

    def json(self, system: str, user: str, max_tokens: int = 1500, model: str = None) -> dict:
        text = self._chat(model or self.model, [{"role": "system", "content": system + "\nReply with one JSON object only."},
                                                {"role": "user", "content": user}], max_tokens)
        return parse_json(text)

    def transcribe(self, data: bytes, media_type: str, model: str = None) -> str:
        import base64

        if not self.vision:
            raise RuntimeError("Set OLLAMA_VISION_MODEL (e.g. qwen2.5vl:7b) to read scanned orders with local AI.")
        if not media_type.startswith("image/"):
            raise RuntimeError("Local AI reads photos of orders; install Tesseract OCR for scanned PDFs.")
        msg = {"role": "user", "images": [base64.b64encode(data).decode()],
               "content": ("Transcribe this Indian court document exactly as written, in its original language. "
                           "Keep dates, case numbers and names exactly. Output only the text. "
                           "If a word is illegible write [illegible].")}
        return self._chat(self.vision, [msg], 8000, json_mode=False)


_llm: LLM | None = None
_checked_at = 0.0


def get_llm() -> LLM:
    """The configured model. If Ollama is not running yet, retry every minute instead of staying offline."""
    global _llm, _checked_at
    import time

    if _llm is not None and not (isinstance(_llm, NullLLM) and LLM_PROVIDER == "ollama"
                                 and time.time() - _checked_at > 60):
        return _llm
    _checked_at = time.time()
    if LLM_PROVIDER == "anthropic" and ANTHROPIC_API_KEY:
        try:
            _llm = AnthropicLLM(ANTHROPIC_API_KEY, MODEL)
        except ImportError:
            _llm = NullLLM()
    elif LLM_PROVIDER == "ollama":
        installed = ollama_reachable()
        if installed and (_has(installed, MODEL) or _has(installed, MODEL_FAST)):
            strong = MODEL if _has(installed, MODEL) else MODEL_FAST
            fast = MODEL_FAST if _has(installed, MODEL_FAST) else MODEL
            _llm = OllamaLLM(strong, fast, OLLAMA_VISION_MODEL if _has(installed, OLLAMA_VISION_MODEL or "-") else "")
        else:
            _llm = NullLLM()
    else:
        _llm = NullLLM()
    return _llm


def llm_status() -> dict:
    """Plain-language AI status for the Settings screen."""
    llm = get_llm()
    if LLM_PROVIDER == "ollama":
        installed = ollama_reachable()
        if not installed:
            return {"provider": "ollama", "ready": False, "message": "Ollama is not running. Start the Ollama app."}
        missing = [m for m in (MODEL, MODEL_FAST, OLLAMA_EMBED_MODEL) if not _has(installed, m)]
        return {"provider": "ollama", "ready": llm.available, "model": getattr(llm, "model", None),
                "model_fast": getattr(llm, "fast", None), "missing": missing,
                "message": ("Ready." if not missing else "Install: " + ", ".join(f"ollama pull {m}" for m in missing))}
    return {"provider": LLM_PROVIDER, "ready": llm.available, "model": getattr(llm, "model", None),
            "message": "Ready." if llm.available else "AI is not connected."}


def set_llm(llm: LLM | None) -> None:
    """Used by tests to inject a fake model."""
    global _llm, _checked_at
    _llm = llm
    _checked_at = 0.0
