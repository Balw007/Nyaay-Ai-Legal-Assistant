#!/usr/bin/env bash
# Start Nyaay on Mac or Linux. First run installs what it needs. Usage: ./start-nyaay.sh [rebuild]
set -u
cd "$(dirname "$0")"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info[:2] >= (3,9) else 1)'; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[X] Python 3.9 or newer was not found. Install it (Mac: brew install python, Ubuntu: sudo apt install python3 python3-venv)."
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Creating a private Python environment, first time only ..."
  "$PY" -m venv .venv || { echo "[X] Could not create the environment. On Ubuntu: sudo apt install python3-venv"; exit 1; }
fi
VPY=.venv/bin/python

if ! cmp -s requirements.txt .venv/installed-requirements.txt; then
  echo "Installing Python packages, first time only, a few minutes ..."
  "$VPY" -m pip install --disable-pip-version-check -q -r requirements.txt || { echo "[X] Package install failed. Check your internet and run again."; exit 1; }
  cp requirements.txt .venv/installed-requirements.txt
fi

command -v node >/dev/null 2>&1 || echo "[!] Node.js 20+ not found: install from https://nodejs.org for the new screens. Starting the basic screens meanwhile."
command -v ollama >/dev/null 2>&1 || echo "[!] Ollama not found: install from https://ollama.com/download for AI answers, then run ./setup-ai.sh"
command -v tesseract >/dev/null 2>&1 || echo "[!] Tesseract OCR not found, so scanned orders cannot be read (Ubuntu: sudo apt install tesseract-ocr tesseract-ocr-hin tesseract-ocr-mar)."

ARGS=""
[ "${1:-}" = "rebuild" ] && ARGS="--rebuild"
exec "$VPY" -m app.launch $ARGS
