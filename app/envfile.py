"""Read settings from a `.env` file in the project folder, so a Windows user can edit a text file instead of
setting environment variables. Variables already set in the environment win."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def parse(text: str) -> dict:
    out = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if val[:1] in "\"'" and val[-1:] == val[:1] and len(val) >= 2:
            val = val[1:-1]
        elif " #" in val:
            val = val.split(" #", 1)[0].rstrip()
        if key:
            out[key] = val
    return out


def load(path: Path = ROOT / ".env") -> dict:
    if "pytest" in sys.modules or not path.is_file():
        return {}
    try:
        values = parse(path.read_text(encoding="utf-8-sig"))
    except OSError:
        return {}
    for k, v in values.items():
        if v != "" and k not in os.environ:
            os.environ[k] = v
    return values
