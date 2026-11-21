"""Passwords, session tokens, login throttling and reversible PII redaction. Standard library only."""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict
from typing import Optional

# ------------------------------------------------------------------ passwords (scrypt)

_N, _R, _P = 2 ** 14, 8, 1


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        got = hashlib.scrypt(pw.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                             dklen=len(base64.b64decode(dk)))
        return hmac.compare_digest(got, base64.b64decode(dk))
    except Exception:
        return False


def password_problem(pw: str) -> Optional[str]:
    if len(pw) < 10:
        return "Use at least 10 characters."
    if pw.lower() in {"password123", "1234567890", "qwertyuiop"} or len(set(pw)) < 5:
        return "This password is too easy to guess."
    return None


# ------------------------------------------------------------------ tokens

def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


# ------------------------------------------------------------------ login throttling (per process)

class Throttle:
    def __init__(self, limit: int = 6, window: int = 600):
        self.limit, self.window = limit, window
        self.hits: dict = defaultdict(list)

    def blocked(self, key: str) -> bool:
        now = time.time()
        self.hits[key] = [t for t in self.hits[key] if now - t < self.window]
        return len(self.hits[key]) >= self.limit

    def fail(self, key: str) -> None:
        self.hits[key].append(time.time())

    def clear(self, key: str) -> None:
        self.hits.pop(key, None)


login_throttle = Throttle()

# ------------------------------------------------------------------ PII redaction (reversible)
# Identifiers are swapped for tokens before text goes to an AI provider and restored in the reply.
# Names are kept: without them the AI cannot read an order or a draft.

PII_PATTERNS = [
    ("AADHAAR", re.compile(r"\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b")),
    ("PAN", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    ("PHONE", re.compile(r"(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{9}(?!\d)")),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")),
    ("ACCOUNT", re.compile(r"(?i)(?<=a/c no\.\s)\d{9,18}|(?<=account no\.\s)\d{9,18}|(?<=account number\s)\d{9,18}")),
]


def redact(text: str) -> tuple:
    mapping: dict = {}
    counter = [0]

    def sub_for(kind):
        def _s(m):
            val = m.group(0)
            for k, v in mapping.items():
                if v == val:
                    return k
            counter[0] += 1
            key = f"⟦{kind}-{counter[0]}⟧"
            mapping[key] = val
            return key
        return _s

    for kind, pat in PII_PATTERNS:
        text = pat.sub(sub_for(kind), text)
    return text, mapping


def restore(obj, mapping: dict):
    if not mapping:
        return obj
    if isinstance(obj, str):
        for k, v in mapping.items():
            obj = obj.replace(k, v)
        return obj
    if isinstance(obj, list):
        return [restore(x, mapping) for x in obj]
    if isinstance(obj, dict):
        return {k: restore(v, mapping) for k, v in obj.items()}
    return obj
