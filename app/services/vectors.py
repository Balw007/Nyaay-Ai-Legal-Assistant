"""Semantic search over paragraphs (optional).

Install `fastembed` and run `python -m app.ingest embed` once; afterwards every search combines keyword ranking
with meaning-based ranking, so "cheque given as security" also finds "post-dated cheque towards guarantee".
Vectors live in the same corpus.db (table para_vec, float32). Search is exact cosine over a numpy matrix,
which is fast enough for a few million paragraphs on one machine.
"""
from __future__ import annotations

import threading
from contextlib import closing
from typing import Callable, Optional

from ..config import EMBED_MODEL, EMBED_PROVIDER, OLLAMA_EMBED_MODEL, OLLAMA_TIMEOUT, OLLAMA_URL

_model = None
_lock = threading.Lock()
_cache = {"n": -1, "ids": None, "mat": None}


class Embedder:
    dim = 0

    def embed(self, texts: list) -> list:  # pragma: no cover
        raise NotImplementedError


class FastEmbedder(Embedder):
    def __init__(self, name: str = EMBED_MODEL):
        from fastembed import TextEmbedding  # optional dependency

        self.m = TextEmbedding(model_name=name)

    def embed(self, texts: list) -> list:
        return [list(map(float, v)) for v in self.m.embed(texts)]


class OllamaEmbedder(Embedder):
    """nomic-embed-text through the local Ollama. Uses nomic's document/query prefixes for better matches."""

    def __init__(self, name: str = OLLAMA_EMBED_MODEL):
        import httpx

        from .llm import _has, ollama_reachable

        if not _has(ollama_reachable(), name):
            raise RuntimeError(f"Ollama embedding model missing: ollama pull {name}")
        self.name = name
        self.http = httpx.Client(timeout=OLLAMA_TIMEOUT)
        self.nomic = "nomic" in name

    def _embed(self, texts: list) -> list:
        r = self.http.post(f"{OLLAMA_URL}/api/embed", json={"model": self.name, "input": texts})
        r.raise_for_status()
        return r.json()["embeddings"]

    def embed(self, texts: list) -> list:
        return self._embed([("search_document: " + t) if self.nomic else t for t in texts])

    def embed_query(self, q: str) -> list:
        return self._embed([("search_query: " + q) if self.nomic else q])[0]


def get_embedder() -> Optional[Embedder]:
    global _model
    if _model is None:
        _model = False
        if EMBED_PROVIDER in ("auto", "fastembed"):
            try:
                _model = FastEmbedder()
            except Exception:
                _model = False
        if not _model and EMBED_PROVIDER in ("auto", "ollama"):
            try:
                _model = OllamaEmbedder()
            except Exception:
                _model = False
    return _model or None


def model_name() -> Optional[str]:
    e = get_embedder()
    return getattr(e, "name", None) or (EMBED_MODEL if e else None)


def set_embedder(e: Optional[Embedder]) -> None:
    """Tests inject a small fake embedder."""
    global _model
    _model = e if e is not None else None
    _cache.update(n=-1, ids=None, mat=None)


def _np():
    import numpy as np  # comes with fastembed
    return np


def status(store) -> dict:
    with closing(store.conn()) as c:
        n = c.execute("SELECT COUNT(*) n FROM para_vec").fetchone()["n"]
        total = c.execute("SELECT COUNT(*) n FROM paras").fetchone()["n"]
    ready = n > 0 and get_embedder() is not None
    return {"ready": ready, "vectors": n, "paragraphs": total, "model": model_name() if ready else None}


def build(store, batch: int = 256, progress: Callable = print) -> int:
    e = get_embedder()
    if e is None:
        raise RuntimeError("Semantic search needs an embedding model: start Ollama and run "
                           f"'ollama pull {OLLAMA_EMBED_MODEL}' (or: python -m pip install fastembed)")
    np = _np()
    done = 0
    while True:
        with closing(store.conn()) as c:
            rows = c.execute("SELECT p.id, p.text FROM paras p LEFT JOIN para_vec v ON v.pid=p.id "
                             "WHERE v.pid IS NULL LIMIT ?", (batch,)).fetchall()
            if not rows:
                break
            vecs = e.embed([r["text"][:2000] for r in rows])
            for r, v in zip(rows, vecs):
                a = np.asarray(v, dtype="float32")
                a /= (np.linalg.norm(a) or 1.0)
                c.execute("INSERT OR REPLACE INTO para_vec(pid, vec) VALUES(?,?)", (r["id"], a.tobytes()))
            c.commit()
        done += len(rows)
        progress(f"embedded {done} paragraphs")
    _cache.update(n=-1)
    return done


def _matrix(store):
    np = _np()
    with closing(store.conn()) as c:
        n = c.execute("SELECT COUNT(*) n FROM para_vec").fetchone()["n"]
        if n == _cache["n"] and _cache["mat"] is not None:
            return _cache["ids"], _cache["mat"]
        with _lock:
            rows = c.execute("SELECT pid, vec FROM para_vec ORDER BY pid").fetchall()
            ids = np.asarray([r["pid"] for r in rows], dtype="int64")
            mat = np.vstack([np.frombuffer(r["vec"], dtype="float32") for r in rows]) if rows else None
            _cache.update(n=n, ids=ids, mat=mat)
    return _cache["ids"], _cache["mat"]


def search(store, q: str, k: int = 200) -> list:
    """[(paragraph_id, cosine)] best first. Empty when semantic search is not set up."""
    e = get_embedder()
    if e is None:
        return []
    try:
        ids, mat = _matrix(store)
    except Exception:
        return []
    if mat is None:
        return []
    np = _np()
    qv = np.asarray(e.embed_query(q) if hasattr(e, "embed_query") else e.embed([q])[0], dtype="float32")
    qv /= (np.linalg.norm(qv) or 1.0)
    sims = mat @ qv
    k = min(k, len(sims))
    top = np.argpartition(-sims, k - 1)[:k]
    top = top[np.argsort(-sims[top])]
    return [(int(ids[i]), float(sims[i])) for i in top]
