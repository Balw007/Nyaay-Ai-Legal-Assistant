"""Central configuration. Everything is overridable with environment variables."""
import os
from pathlib import Path

from .envfile import load as _load_env

_load_env()  # a .env file next to the app sets any variable below that is not already set

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

DATABASE_URL = os.getenv("NYAAI_DATABASE_URL", "sqlite:///./nyaai.db")

# LLM is optional. Without one the system falls back to rule-based extraction
# and never marks a citation as VERIFIED on its own.
#   NYAAI_LLM=ollama     local models through Ollama (default; free, nothing leaves the machine)
#   NYAAI_LLM=anthropic  Claude API (needs ANTHROPIC_API_KEY)
#   NYAAI_LLM=none       rules only
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
LLM_PROVIDER = os.getenv("NYAAI_LLM", "ollama").lower()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")            # answers, drafting polish
OLLAMA_MODEL_FAST = os.getenv("OLLAMA_MODEL_FAST", "qwen3:4b")  # summaries, order reading, reranking
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL", "")      # optional, e.g. qwen2.5vl:7b, reads photos of orders
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "300"))      # CPU-only machines are slow

_DEFAULT_MODEL = OLLAMA_MODEL if LLM_PROVIDER == "ollama" else "claude-opus-5-5"
_DEFAULT_MODEL_FAST = OLLAMA_MODEL_FAST if LLM_PROVIDER == "ollama" else "claude-haiku-5-5"
MODEL = os.getenv("NYAAI_MODEL", _DEFAULT_MODEL)

# Judgment index. The default is a small FICTIONAL fixture used for development and tests.
# Point this at a real index export (same JSON shape) once the open datasets are ingested.
JUDGMENT_INDEX = os.getenv("NYAAI_JUDGMENTS", str(DATA_DIR / "fixtures" / "sample_judgments.json"))

OCR_LANG = os.getenv("NYAAI_OCR_LANG", "eng")

# The searchable judgment database (SQLite). Fill it with: python -m app.ingest sc --years 2024
CORPUS_DB = os.getenv("NYAAI_CORPUS", "./corpus.db")
# Off by default: the library starts empty and is filled with real judgments (Library screen or app.ingest).
# NYAAI_DEMO=1 loads 3 FICTIONAL judgments for development only.
DEMO_SEED = os.getenv("NYAAI_DEMO", "0") == "1"

# ---------------------------------------------------------------- AI models
# Strong model for answers and drafting; fast model for summaries, order reading, support checks, reranking.
MODEL_FAST = os.getenv("NYAAI_MODEL_FAST", _DEFAULT_MODEL_FAST)
DEFAULT_MONTHLY_TOKEN_BUDGET = int(os.getenv("NYAAI_TOKEN_BUDGET", "3000000"))  # per firm per month

# ---------------------------------------------------------------- auth & hosting
SESSION_DAYS = int(os.getenv("NYAAI_SESSION_DAYS", "14"))
COOKIE_SECURE = os.getenv("NYAAI_COOKIE_SECURE", "0") == "1"   # set 1 behind HTTPS
PUBLIC_URL = os.getenv("NYAAI_PUBLIC_URL", "http://localhost:8000")
# Where people open Nyaay in the browser (the web app). Invite links point here.
WEB_URL = os.getenv("NYAAY_WEB_URL", "http://localhost:3000").rstrip("/")
BACKUP_DIR = os.getenv("NYAAI_BACKUP_DIR", "./backups")

# ---------------------------------------------------------------- integrations (all optional)
INDIANKANOON_TOKEN = os.getenv("INDIANKANOON_TOKEN")             # api.indiankanoon.org (paid, per request)
ECOURTSINDIA_TOKEN = os.getenv("ECOURTSINDIA_TOKEN")             # webapi.ecourtsindia.com (paid)
WA_TOKEN = os.getenv("WHATSAPP_TOKEN")                           # WhatsApp Cloud API permanent token
WA_PHONE_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
WA_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
WA_APP_SECRET = os.getenv("WHATSAPP_APP_SECRET", "")
WA_GRAPH_VERSION = os.getenv("WHATSAPP_GRAPH_VERSION", "v21.0")
WA_BRIEF_TEMPLATE = os.getenv("WHATSAPP_BRIEF_TEMPLATE", "")    # approved template with one body parameter
EMBED_MODEL = os.getenv("NYAAI_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
# Semantic search embeddings: auto = fastembed if installed, else Ollama (OLLAMA_EMBED_MODEL); none = keyword only
EMBED_PROVIDER = os.getenv("NYAAI_EMBED", "auto").lower()

# ---------------------------------------------------------------- morning brief
# Telegram: create a bot with @BotFather and paste its token here, or in Settings (per firm).
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
# The brief goes out once a day from this hour (Indian Standard Time) while the server is running.
BRIEF_HOUR_IST = int(os.getenv("NYAAY_BRIEF_HOUR", "8"))
SCHEDULER = os.getenv("NYAAY_SCHEDULER", "1") == "1"
