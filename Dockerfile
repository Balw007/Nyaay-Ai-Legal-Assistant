# Nyaay backend. Includes Tesseract with Hindi and Marathi for scanned orders.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-mar postgresql-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt "psycopg[binary]>=3.1" fastembed gunicorn
COPY app ./app
COPY deploy ./deploy
RUN useradd -m nyaai && mkdir -p /data && chown -R nyaai /data
USER nyaai
ENV NYAAI_CORPUS=/data/corpus.db NYAAI_BACKUP_DIR=/data/backups NYAAI_OCR_LANG=eng+hin+mar
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')"
# One worker on purpose: library loading jobs and AI status live in the process, so a second worker would show a
# different (idle) state half the time. The app is async, so one worker serves a chambers comfortably.
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "1", "-b", "0.0.0.0:8000", "--timeout", "300"]
