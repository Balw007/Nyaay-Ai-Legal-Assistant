"""Nyaay self-check. Run it on the PC where Nyaay will be used:

    python -m app.doctor            # everything, including a real download from the open-data buckets
    python -m app.doctor --quick    # skip the slow checks (model test, downloads)
    python -m app.doctor --json     # machine-readable

Each line is PASS, WARN or FAIL, with the exact command that fixes it. Exit code is 1 if anything FAILs.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Callable, Optional

from . import config

PASS, WARN, FAIL, INFO = "PASS", "WARN", "FAIL", "INFO"
WINDOWS = platform.system() == "Windows"
ROOT = Path(__file__).resolve().parent.parent


def _r(status: str, name: str, detail: str = "", fix: str = "", **extra) -> dict:
    return {"status": status, "name": name, "detail": detail, "fix": fix, **extra}


# ------------------------------------------------------------------ system

def check_python() -> dict:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if (v.major, v.minor) < (3, 9):
        return _r(FAIL, "Python", f"{ver} is too old (need 3.9 or newer)", "Install Python 3.12 from https://www.python.org/downloads/")
    return _r(PASS, "Python", ver)


def _run(cmd: list, timeout: int = 8) -> Optional[str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=WINDOWS)
        return (p.stdout or p.stderr or "").strip()
    except Exception:
        return None


def check_node() -> dict:
    out = _run(["node", "--version"])
    if not out:
        return _r(WARN, "Node.js", "not found (needed only for the web screens)",
                  "Install Node.js 20 or newer from https://nodejs.org (LTS), then reopen this window")
    try:
        major = int(out.lstrip("v").split(".")[0])
    except ValueError:
        return _r(WARN, "Node.js", out, "Install Node.js 20+ from https://nodejs.org")
    if major < 20:
        return _r(FAIL, "Node.js", f"{out} is too old (need 20 or newer)", "Install the current LTS from https://nodejs.org")
    return _r(PASS, "Node.js", out)


def check_packages() -> dict:
    need = {"fastapi": "fastapi", "sqlalchemy": "sqlalchemy", "pypdf": "pypdf", "httpx": "httpx", "uvicorn": "uvicorn",
            "docx": "python-docx", "python_multipart": "python-multipart"}
    missing = []
    for mod, pip in need.items():
        try:
            __import__(mod)
        except Exception:
            if mod == "python_multipart":            # older releases are imported as "multipart"
                try:
                    __import__("multipart")
                    continue
                except Exception:
                    pass
            missing.append(pip)
    if missing:
        return _r(FAIL, "Python packages", "missing: " + ", ".join(missing), "python -m pip install -r requirements.txt")
    return _r(PASS, "Python packages", "all required packages are installed")


def _ram_gb() -> Optional[float]:
    try:
        if WINDOWS:
            import ctypes

            class MEM(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                            ("avail", ctypes.c_ulonglong), ("pt", ctypes.c_ulonglong), ("pa", ctypes.c_ulonglong),
                            ("vt", ctypes.c_ulonglong), ("va", ctypes.c_ulonglong), ("ve", ctypes.c_ulonglong)]

            m = MEM()
            m.l = ctypes.sizeof(MEM)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.total / 2**30
        if sys.platform == "darwin":
            return int(_run(["sysctl", "-n", "hw.memsize"]) or 0) / 2**30 or None
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal"):
                return int(line.split()[1]) / 2**20
    except Exception:
        return None
    return None


def check_memory() -> dict:
    gb = _ram_gb()
    if gb is None:
        return _r(INFO, "Memory", "could not read the amount of RAM")
    if gb < 6:
        return _r(FAIL, "Memory", f"{gb:.0f} GB RAM is too little for local AI",
                  "Use the smaller model (OLLAMA_MODEL=qwen3:4b) or connect a hosted AI (NYAAI_LLM=anthropic)")
    if gb < 14:
        return _r(WARN, "Memory", f"{gb:.0f} GB RAM: the 8B model will be slow or tight",
                  "Set OLLAMA_MODEL=qwen3:4b in .env for faster, lighter answers")
    return _r(PASS, "Memory", f"{gb:.0f} GB RAM")


def check_disk() -> dict:
    free = shutil.disk_usage(str(ROOT)).free / 2**30
    if free < 3:
        return _r(FAIL, "Disk space", f"{free:.1f} GB free", "Free at least 15 GB: models need about 8 GB and the library grows with each year loaded")
    if free < 15:
        return _r(WARN, "Disk space", f"{free:.1f} GB free", "Models need about 8 GB, plus about 1 GB per year of Supreme Court judgments")
    return _r(PASS, "Disk space", f"{free:.0f} GB free")


def _port_state(port: int) -> str:
    """free | nyaay | busy"""
    with socket.socket() as s:
        s.settimeout(0.5)
        if s.connect_ex(("127.0.0.1", port)) != 0:
            return "free"
    try:
        import httpx

        r = httpx.get(f"http://127.0.0.1:{port}/health", timeout=2)
        if r.status_code == 200 and '"ai"' in r.text:
            return "nyaay"
        r = httpx.get(f"http://127.0.0.1:{port}/login", timeout=2)       # the web app has no /health
        if r.status_code == 200 and "Nyaay" in r.text:
            return "nyaay"
    except Exception:
        pass
    return "busy"


def check_ports() -> list:
    out = []
    for port, what in ((8000, "Nyaay server"), (3000, "Nyaay web app")):
        st = _port_state(port)
        if st == "free":
            out.append(_r(PASS, f"Port {port}", f"free for the {what}"))
        elif st == "nyaay":
            out.append(_r(PASS, f"Port {port}", f"{what} is already running"))
        else:
            fix = (f"netstat -ano | findstr :{port}   then   taskkill /PID <pid> /F" if WINDOWS
                   else f"lsof -i :{port}   then stop that program")
            out.append(_r(WARN, f"Port {port}", f"in use by another program, so the {what} cannot start", fix))
    return out


def _library_contents() -> list:
    """Is there anything to search, and are the Acts the judgments cite loaded? Advice only: never a failure."""
    out = []
    p = Path(config.CORPUS_DB)
    if not p.exists():
        return [_r(WARN, "Judgment library", "no judgments loaded yet", "Open Library in the app and load a few years of judgments")]
    try:
        from .services import acts as actsvc
        from .services.store import Store

        st = Store(str(p))
        n = st.stats()["real_judgments"]
        out.append(_r(PASS if n else WARN, "Judgment library", f"{n:,} judgments" if n else "no real judgments loaded yet",
                      "" if n else "Open Library in the app and load a few years of judgments"))
        loaded = [a["code"] for a in actsvc.list_acts(st) if a["loaded"]]
        if loaded:
            out.append(_r(PASS, "Bare Acts", f"{len(loaded)} Acts loaded"))
        else:
            out.append(_r(WARN, "Bare Acts", "no Acts loaded", "Open Bare Acts in the app and press Download Acts"))
    except Exception as exc:
        out.append(_r(WARN, "Judgment library", f"could not read it: {exc}"))
    return out


def check_database() -> list:
    out = []
    try:
        from sqlalchemy import create_engine, text

        eng = create_engine(config.DATABASE_URL)
        with eng.connect() as c:
            c.execute(text("select 1"))
        out.append(_r(PASS, "Firm database", config.DATABASE_URL.split("@")[-1]))
        from .db import head_version, schema_version

        have, newest = schema_version(eng), head_version()
        if have == newest:
            out.append(_r(PASS, "Database version", f"up to date ({newest})"))
        elif have is None and "firms" not in __import__("sqlalchemy").inspect(eng).get_table_names():
            out.append(_r(PASS, "Database version", "new database: Nyaay sets it up on first start"))
        else:
            out.append(_r(WARN, "Database version", f"{have or 'not versioned'}; newest is {newest}",
                          "Start Nyaay once (it upgrades by itself), or run: python -m app.dbtool upgrade"))
        eng.dispose()
    except Exception as exc:
        out.append(_r(FAIL, "Firm database", f"cannot open {config.DATABASE_URL.split('@')[-1]}: {exc}",
                      "Check NYAAI_DATABASE_URL in .env, and that the folder is writable"))
    try:
        d = Path(config.CORPUS_DB).resolve().parent
        with tempfile.NamedTemporaryFile(dir=d, delete=True):
            pass
        from .services.store import Store

        with tempfile.TemporaryDirectory() as td:
            Store(str(Path(td) / "t.db")).stats()
        out.append(_r(PASS, "Judgment library file", f"{Path(config.CORPUS_DB).resolve()} can be written"))
        out.extend(_library_contents())
    except Exception as exc:
        out.append(_r(FAIL, "Judgment library file", f"cannot write next to {config.CORPUS_DB}: {exc}",
                      "Run Nyaay from a folder you own (not Program Files), or set NYAAI_CORPUS to a writable path"))
    return out


# ------------------------------------------------------------------ OCR

def check_ocr() -> list:
    from .services import ocr

    st = ocr.engine_status()
    out = []
    if not shutil.which("tesseract") and not st["tesseract"]:
        fix = ("Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki (tick Hindi and Marathi), add it to PATH, "
               "then: pip install pytesseract pillow pymupdf") if WINDOWS else \
              "sudo apt install tesseract-ocr tesseract-ocr-hin tesseract-ocr-mar   (Mac: brew install tesseract tesseract-lang)"
        return [_r(WARN, "OCR (Tesseract)", "not installed: scanned orders cannot be read", fix)]
    if not st["tesseract"]:
        return [_r(WARN, "OCR (Tesseract)", "the program is installed but Python cannot use it",
                   "pip install pytesseract pillow    (and make sure tesseract is on PATH)")]
    out.append(_r(PASS, "OCR (Tesseract)", "languages: " + ", ".join(st["languages_installed"][:8])))
    if st["languages_missing"]:
        out.append(_r(WARN, "OCR languages", "missing: " + ", ".join(st["languages_missing"]) + " (Hindi/Marathi orders will read poorly)",
                      "Re-run the Tesseract installer and tick the Hindi and Marathi data; or download hin.traineddata / mar.traineddata into its tessdata folder"))
    if not st["rasteriser"]:
        out.append(_r(WARN, "OCR for PDFs", "no way to turn PDF pages into images", "pip install pymupdf"))
    return out


# ------------------------------------------------------------------ Ollama

def _ollama_models() -> Optional[list]:
    import httpx

    r = httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=4)
    r.raise_for_status()
    return [m["name"] for m in r.json().get("models", [])]


def _has_model(installed: list, want: str) -> bool:
    return any(n == want or n.split(":")[0] == want or n.startswith(want + ":") for n in installed) if ":" not in want \
        else any(n == want or n == want + ":latest" for n in installed)


def check_ollama(quick: bool = False) -> list:
    if config.LLM_PROVIDER != "ollama":
        return [_r(INFO, "AI", f"provider is '{config.LLM_PROVIDER}', local Ollama checks skipped")]
    import httpx

    try:
        installed = _ollama_models()
    except Exception:
        fix = ("Install Ollama from https://ollama.com/download, open it, then run setup-ai.bat" if WINDOWS
               else "Install Ollama from https://ollama.com/download, then run: ollama serve")
        return [_r(FAIL, "Ollama", f"not reachable at {config.OLLAMA_URL}", fix)]
    out = [_r(PASS, "Ollama", f"running, {len(installed)} model(s) installed")]
    wanted = [(config.OLLAMA_MODEL, "answers"), (config.OLLAMA_MODEL_FAST, "quick tasks"),
              (config.OLLAMA_EMBED_MODEL, "search by meaning")]
    for model, why in wanted:
        if _has_model(installed, model):
            out.append(_r(PASS, f"Model {model}", why))
        else:
            out.append(_r(FAIL if model == config.OLLAMA_MODEL else WARN, f"Model {model}", f"not downloaded ({why})",
                          f"ollama pull {model}"))
    if config.OLLAMA_VISION_MODEL:
        if _has_model(installed, config.OLLAMA_VISION_MODEL):
            out.append(_r(PASS, f"Vision model {config.OLLAMA_VISION_MODEL}", "reads photos of orders"))
        else:
            out.append(_r(WARN, f"Vision model {config.OLLAMA_VISION_MODEL}", "not downloaded",
                          f"ollama pull {config.OLLAMA_VISION_MODEL}"))
    if quick:
        return out
    if _has_model(installed, config.OLLAMA_MODEL_FAST):
        t = time.time()
        try:
            r = httpx.post(f"{config.OLLAMA_URL}/api/chat", timeout=config.OLLAMA_TIMEOUT, json={
                "model": config.OLLAMA_MODEL_FAST, "stream": False, "think": False,
                "messages": [{"role": "user", "content": "Reply with the single word: ready"}],
                "options": {"num_predict": 8, "temperature": 0}})
            if r.status_code == 400:  # older Ollama without the think switch
                r = httpx.post(f"{config.OLLAMA_URL}/api/chat", timeout=config.OLLAMA_TIMEOUT, json={
                    "model": config.OLLAMA_MODEL_FAST, "stream": False,
                    "messages": [{"role": "user", "content": "Reply with the single word: ready"}],
                    "options": {"num_predict": 8, "temperature": 0}})
            r.raise_for_status()
            secs = time.time() - t
            msg = f"{config.OLLAMA_MODEL_FAST} answered in {secs:.1f}s (includes loading the model the first time)"
            out.append(_r(PASS if secs < 60 else WARN, "AI answer test", msg,
                          "" if secs < 60 else "Very slow. Close other programs, or use a smaller model", seconds=round(secs, 1)))
        except Exception as exc:
            out.append(_r(FAIL, "AI answer test", f"the model did not answer: {exc}", "Quit Ollama from the system tray and open it again, close other programs to free memory, "
                      f"then run: ollama stop {config.OLLAMA_MODEL}   and   ollama run {config.OLLAMA_MODEL_FAST} \"hi\""))
    if _has_model(installed, config.OLLAMA_EMBED_MODEL):
        t = time.time()
        try:
            r = httpx.post(f"{config.OLLAMA_URL}/api/embed", timeout=120,
                           json={"model": config.OLLAMA_EMBED_MODEL, "input": ["search_query: cheque dishonour notice period"]})
            if r.status_code == 404:
                r = httpx.post(f"{config.OLLAMA_URL}/api/embeddings", timeout=120,
                               json={"model": config.OLLAMA_EMBED_MODEL, "prompt": "cheque dishonour notice period"})
            r.raise_for_status()
            j = r.json()
            vec = (j.get("embeddings") or [j.get("embedding")])[0]
            out.append(_r(PASS, "Embedding test", f"{len(vec)} numbers in {time.time() - t:.1f}s", seconds=round(time.time() - t, 1)))
        except Exception as exc:
            out.append(_r(FAIL, "Embedding test", f"failed: {exc}", f"ollama pull {config.OLLAMA_EMBED_MODEL}"))
    return out


# ------------------------------------------------------------------ open data

def check_open_data(say: Callable[[str], None] = lambda s: None) -> list:
    from . import ingest as ing

    out = []
    this_year = date.today().year
    # Supreme Court: download and clean one real judgment, then show what the pipeline made of it.
    names, year = [], this_year
    try:
        for y in (this_year, this_year - 1, this_year - 2):
            names = ing.list_year(ing.S3_SC, y, ing.http_get)
            if names:
                year = y
                break
        if not names:
            raise RuntimeError("the bucket listing was empty")
        out.append(_r(PASS, "Supreme Court open data", f"{len(names)} judgments listed for {year}"))
    except Exception as exc:
        return [_r(FAIL, "Supreme Court open data", f"cannot reach the bucket: {exc}",
                   "Check your internet or any firewall/VPN that blocks amazonaws.com. Corporate and some school networks block it.")]
    try:
        name = names[0]
        data = ing.http_get(f"{ing.S3_SC}/data/pdf/year={year}/english/{ing.quote(name)}")
        text = ing.pdf_to_text(data)
        scanned = len(text.replace("\x0c", "").strip()) < ing.MIN_TEXT
        rec = ing.build_record(f"doctor-{year}", year, text, {}, "sc-open-data", "")
        if rec is None:
            out.append(_r(WARN, "Judgment cleaning test", f"{name}: no usable text" + (" (a scan)" if scanned else ""),
                          "Try again; if it keeps failing run: python -m app.ingest probe"))
        else:
            paras = rec["paragraphs"]
            text_all = " ".join(p[1] if isinstance(p, (tuple, list)) else (p.get("text", "") if isinstance(p, dict) else str(p))
                                for p in paras)
            debris = [m for m in ("Digitally signed", "Signature Not Verified", "REPORTABLE") if m.lower() in text_all.lower()]
            detail = (f"title: {rec['title'][:70]!r}; date: {rec['decision_date'] or 'not found'}; "
                      f"{len(paras)} paragraphs; {len(rec['cite_norms'])} citations found")
            out.append(_r(WARN if debris else PASS, "Judgment cleaning test",
                          detail + (f"; leftover debris: {', '.join(debris)}" if debris else "; no signature or page debris"),
                          "Tell the developer which judgment this was and send a screenshot" if debris else "",
                          sample={"file": name, "title": rec["title"], "date": rec["decision_date"], "paragraphs": len(paras)}))
    except Exception as exc:
        out.append(_r(FAIL, "Judgment cleaning test", f"download or parse failed: {exc}", "Run again; check your internet"))
    # High Courts: list courts for the latest year that has data.
    try:
        courts = []
        for y in (this_year, this_year - 1, this_year - 2):
            courts = ing.hc_list_courts(y)
            if courts:
                break
        if courts:
            out.append(_r(PASS, "High Court open data", f"{len(courts)} courts listed"))
        else:
            out.append(_r(WARN, "High Court open data", "reachable but no courts listed", "Try again later"))
    except Exception as exc:
        out.append(_r(WARN, "High Court open data", f"cannot reach the bucket: {exc}", "Check your internet or firewall"))
    return out


# ------------------------------------------------------------------ run

def run_checks(quick: bool = False, offline: bool = False, say: Callable[[str], None] = lambda s: None) -> list:
    steps = [("system", lambda: [check_python(), check_node(), check_packages(), check_memory(), check_disk()]),
             ("database", check_database), ("ports", check_ports), ("ocr", check_ocr),
             ("ai", lambda: check_ollama(quick))]
    if not quick and not offline:
        steps.append(("open data", check_open_data))
    results = []
    for label, fn in steps:
        say(f"checking {label} ...")
        try:
            r = fn()
        except Exception as exc:  # a check must never crash the doctor
            r = [_r(WARN, label, f"the check itself failed: {exc}")]
        results.extend(r if isinstance(r, list) else [r])
    return results


def summarise(results: list) -> dict:
    n = {s: sum(1 for r in results if r["status"] == s) for s in (PASS, WARN, FAIL)}
    return {"pass": n[PASS], "warn": n[WARN], "fail": n[FAIL],
            "ready": n[FAIL] == 0, "verdict": "Ready to use" if n[FAIL] == 0 and n[WARN] == 0 else
            ("Usable, with things to improve" if n[FAIL] == 0 else "Fix the FAIL items before using Nyaay")}


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.doctor", description="Check that this computer is ready to run Nyaay.")
    ap.add_argument("--quick", action="store_true", help="skip the model test and the downloads")
    ap.add_argument("--offline", action="store_true", help="skip the open-data download check")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.json:
        res = run_checks(a.quick, a.offline)
        print(json.dumps({"results": res, "summary": summarise(res)}, indent=2))
        return 0 if summarise(res)["ready"] else 1
    print("\nNyaay system check\n" + "=" * 18)
    res = run_checks(a.quick, a.offline, say=lambda s: print(f"  ... {s}", flush=True))
    print()
    for r in res:
        print(f"[{r['status']}] {r['name']}: {r['detail']}")
        if r["fix"] and r["status"] in (WARN, FAIL):
            print(f"       fix: {r['fix']}")
    s = summarise(res)
    print(f"\n{s['pass']} passed, {s['warn']} warnings, {s['fail']} failed. {s['verdict']}.\n")
    return 0 if s["ready"] else 1


if __name__ == "__main__":
    sys.exit(main())
