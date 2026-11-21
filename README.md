# Nyaay

Legal workspace for Indian advocates: research with paragraph-level citations, citation checker, matters with stage and deadline tracking, order reading, drafting, approvals.

## Run on Windows (first time)
1. Install Python 3.9+, Node.js 20+, and Ollama (ollama.com). Open Ollama.
2. Double-click `setup-ai.bat` (downloads the local AI models, once, about 8 GB).
3. Double-click `start-nyaay.bat`. It sets itself up the first time (a few minutes), then opens http://localhost:3000. Close its window to stop Nyaay.
4. Create your chambers account, then open **Library** and click **Load real judgments** (Supreme Court, CC-BY-4.0).

Everything runs on your computer. No sample data is included. Nothing leaves your machine except the open-data downloads.

## If something does not work
Double-click `check-nyaay.bat` (or run `python -m app.doctor`). It tests Python, Node, Ollama and the models, OCR, disk space,
ports, the database and the open-data download, and prints the exact command that fixes each problem.
The same check is in the app: Settings > Data & pilot > System check.

## Scanned orders (OCR)
Photos and scans of court orders, and scanned judgments you upload, are read with Tesseract OCR. Install it once:
- Windows: https://github.com/UB-Mannheim/tesseract/wiki. In the installer tick **Hindi** and **Marathi** under additional language data.
  Nyaay finds it in its default folder. Then `.venv\Scripts\pip install pytesseract pillow pymupdf` (start-nyaay.bat does this for you).
- Mac: `brew install tesseract tesseract-lang`. Ubuntu: `sudo apt install tesseract-ocr tesseract-ocr-hin tesseract-ocr-mar`.

Anything read from a scan is marked for checking. Every page gets a confidence score, and pages under 70% are named so you check them
against the original. Without Tesseract, Nyaay can use a local vision model (`OLLAMA_VISION_MODEL`, see `.env.example`); its text is
always marked for review.

## Legal review
Settings > Legal review > Legal review pack downloads one Word file with every deadline rule, worked date examples, every stage and every
draft template, with tick boxes and a sign-off page. Give it to an advocate. You can also run `python -m app.review_pack`.

## Putting it on a server
See `DEPLOY.md`.

## Notes
- AI proposes, an advocate approves. Deadlines come from fixed rules, not AI.
- Playbooks stay DRAFT until an advocate signs off in Settings > Legal review.
- Tests: `python -m pytest -q`
