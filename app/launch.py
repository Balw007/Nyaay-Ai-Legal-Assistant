"""Start Nyaay: the server and the web app in one window, open the browser, stop both on Ctrl+C.

    python -m app.launch                 # normal start
    python -m app.launch --no-browser
    python -m app.launch --rebuild       # rebuild the web app first (after an update)
    python -m app.launch --api-only      # no Node.js: the plain screens at http://localhost:8000/app/

The start-nyaay.bat / start-nyaay.sh scripts prepare Python and Node and then call this.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

from .envfile import ROOT, load

WINDOWS = os.name == "nt"
WEB = ROOT / "web"
LOGS = ROOT / "logs"


def say(msg: str = "") -> None:
    print(msg, flush=True)


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_http(url: str, seconds: int, proc: subprocess.Popen = None) -> bool:
    import urllib.request

    end = time.time() + seconds
    while time.time() < end:
        if proc is not None and proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                if r.status < 500:
                    return True
        except Exception:
            time.sleep(0.7)
    return False


def kill_tree(p: subprocess.Popen) -> None:
    if p.poll() is not None:
        return
    try:
        if WINDOWS:
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
        else:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
    except Exception:
        try:
            p.terminate()
        except Exception:
            pass


def spawn(cmd: list, cwd: Path, log: Path, env: dict) -> subprocess.Popen:
    LOGS.mkdir(exist_ok=True)
    f = open(log, "ab")
    kw = {"cwd": str(cwd), "stdout": f, "stderr": subprocess.STDOUT, "env": env}
    if WINDOWS:
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        kw["shell"] = cmd[0] in ("npm", "npx")
    else:
        kw["start_new_session"] = True
    return subprocess.Popen(cmd, **kw)


def node_ok() -> bool:
    node = shutil.which("node")
    if not node:
        return False
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=8).stdout.strip()
        return int(out.lstrip("v").split(".")[0]) >= 20
    except Exception:
        return False


def _web_source_is_newer() -> bool:
    """True when any web source file changed after the last build (for example after an update)."""
    try:
        built = (WEB / ".next" / "BUILD_ID").stat().st_mtime
        newest = 0.0
        for base in (WEB / "src", WEB / "public"):
            for f in base.rglob("*"):
                if f.is_file():
                    newest = max(newest, f.stat().st_mtime)
        for name in ("package.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"):
            f = WEB / name
            if f.exists():
                newest = max(newest, f.stat().st_mtime)
        return newest > built
    except Exception:
        return False


def ensure_web_built(rebuild: bool) -> bool:
    npm = ["npm"] if not WINDOWS else ["npm.cmd"]
    if not (WEB / "node_modules").exists():
        say("Installing the web app packages (first time only, a few minutes) ...")
        if subprocess.run(npm + ["install", "--no-audit", "--no-fund"], cwd=WEB).returncode != 0:
            return False
    if rebuild or not (WEB / ".next" / "BUILD_ID").exists() or _web_source_is_newer():
        say("Building the web app (first time, or after an update; about a minute) ...")
        if subprocess.run(npm + ["run", "build"], cwd=WEB).returncode != 0:
            return False
    return True


def start_ollama(env: dict):
    """Start the local Ollama when it is not already running, so the AI works without a second window.

    Returns the process only when Nyaay started it. That is the one Nyaay stops again when it exits.
    An Ollama that was already running (the Ollama app, another window) is never touched.
    Turn this off with NYAAY_MANAGE_OLLAMA=0 in .env.
    """
    from urllib.parse import urlparse

    from .config import LLM_PROVIDER, OLLAMA_URL

    if env.get("NYAAY_MANAGE_OLLAMA", "1").strip() == "0" or LLM_PROVIDER != "ollama":
        return None
    u = urlparse(OLLAMA_URL)
    if (u.hostname or "") not in ("localhost", "127.0.0.1", "::1"):
        return None  # the AI runs on another computer
    port = u.port or 11434
    if port_open(port):
        say("  Ollama is already running. Nyaay will leave it on when it stops.")
        return None
    exe = shutil.which("ollama")
    if not exe:
        say("  Ollama was not found, so the AI is off. Install it from https://ollama.com/download")
        return None
    say("  Starting Ollama ...")
    proc = spawn([exe, "serve"], ROOT, LOGS / "ollama.log", env)
    if wait_http(f"http://127.0.0.1:{port}/api/tags", 40, proc):
        say("  Ollama is ready.")
    else:
        say(f"  Ollama did not start. Details are in {LOGS / 'ollama.log'}")
    return proc


def daily_backup() -> None:
    """A copy of the firm database once a day, kept 14 days. The judgment library is not copied: it can be re-downloaded."""
    try:
        from datetime import datetime

        from .config import BACKUP_DIR, DATABASE_URL
        from .jobs import _sqlite_copy

        if not DATABASE_URL.startswith("sqlite:///"):
            return
        src = Path(DATABASE_URL.replace("sqlite:///", "", 1))
        if not src.exists():
            return
        out = Path(BACKUP_DIR)
        out.mkdir(parents=True, exist_ok=True)
        dst = out / f"nyaai-{datetime.now():%Y%m%d}.db"
        if not dst.exists():
            _sqlite_copy(str(src), dst)
        for old in sorted(out.glob("nyaai-*.db"))[:-14]:
            old.unlink()
    except Exception as exc:  # a backup problem must never stop Nyaay from starting
        say(f"  (Backup skipped: {exc})")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.launch")
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--api-only", action="store_true")
    ap.add_argument("--api-port", type=int, default=8000)
    ap.add_argument("--web-port", type=int, default=3000)
    a = ap.parse_args(argv)
    load()
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    env.setdefault("NYAAI_API", f"http://127.0.0.1:{a.api_port}")

    say("\n  Nyaay\n  -----")
    for port, what in ((a.api_port, "server"), (None if a.api_only else a.web_port, "web app")):
        if port and port_open(port):
            say(f"  Port {port} is already in use, so the {what} cannot start.")
            say("  If Nyaay is already running, just open it in your browser. Otherwise close the program using that port.")
            if not a.no_browser and port == a.web_port:
                webbrowser.open(f"http://localhost:{a.web_port}")
            return 1

    use_web = not a.api_only
    if use_web and not node_ok():
        say("  Node.js 20 or newer was not found, so the new screens cannot start.")
        say("  Install it from https://nodejs.org (LTS) and run this again.")
        say(f"  Starting the basic screens instead at http://localhost:{a.api_port}/app/\n")
        use_web = False
    if use_web and not ensure_web_built(a.rebuild):
        say("  The web app could not be prepared. See the messages above. Starting the basic screens instead.\n")
        use_web = False

    procs = []
    ollama_proc = None

    def _stop(signum, frame):  # closing the window or `kill` should stop both parts too
        raise KeyboardInterrupt

    for name in ("SIGTERM", "SIGBREAK", "SIGHUP"):
        if hasattr(signal, name):
            try:
                signal.signal(getattr(signal, name), _stop)
            except (ValueError, OSError):
                pass
    try:
        ollama_proc = start_ollama(env)
        say("  Starting the server ...")
        api = spawn([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(a.api_port)],
                    ROOT, LOGS / "server.log", env)
        procs.append(api)
        if not wait_http(f"http://127.0.0.1:{a.api_port}/health", 120, api):
            say(f"  The server did not start. Details are in {LOGS / 'server.log'}")
            tail = (LOGS / "server.log").read_text(errors="replace").splitlines()[-8:] if (LOGS / "server.log").exists() else []
            for line in tail:
                say("    " + line)
            return 1
        url = f"http://localhost:{a.api_port}/app/"
        if use_web:
            say("  Starting the web app ...")
            web = spawn(["npm", "run", "start", "--", "-p", str(a.web_port)] if not WINDOWS else ["npm.cmd", "run", "start", "--", "-p", str(a.web_port)],
                        WEB, LOGS / "web.log", env)
            procs.append(web)
            if not wait_http(f"http://127.0.0.1:{a.web_port}/login", 60, web):
                say(f"  The web app did not start. Details are in {LOGS / 'web.log'}")
                return 1
            url = f"http://localhost:{a.web_port}"
        daily_backup()
        say(f"\n  Nyaay is running at {url}")
        say("  Keep this window open. Press Ctrl+C to stop.\n")
        from .services.llm import llm_status

        ai = llm_status()
        say("  AI: " + (f"ready ({ai.get('model')})" if ai.get("ready") else str(ai.get("message")) + "  Run:  python -m app.doctor"))
        if not a.no_browser:
            webbrowser.open(url)
        while all(p.poll() is None for p in procs):
            time.sleep(1)
        say("  A part of Nyaay stopped. See the logs folder.")
        return 1
    except KeyboardInterrupt:
        say("\n  Stopping Nyaay ...")
        return 0
    finally:
        for p in procs:
            kill_tree(p)
        if ollama_proc is not None:
            kill_tree(ollama_proc)
            say("  Ollama stopped.")


if __name__ == "__main__":
    sys.exit(main())
