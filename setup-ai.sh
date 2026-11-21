#!/usr/bin/env bash
# Download the local AI models (one time, about 8 GB).
cd "$(dirname "$0")"
command -v ollama >/dev/null 2>&1 || { echo "Install Ollama first: https://ollama.com/download"; exit 1; }
for m in qwen3:8b qwen3:4b nomic-embed-text; do ollama pull "$m" || { echo "Download failed; run again to continue."; exit 1; }; done
echo "Done. Run: .venv/bin/python -m app.doctor"
