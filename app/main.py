from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .config import SCHEDULER, DEMO_SEED, ECOURTSINDIA_TOKEN, INDIANKANOON_TOKEN, MODEL, MODEL_FAST, WA_TOKEN
from .db import Base, engine, migrate
from .routes import (admin, auth, brief, calendar_ics, citations, features, integrations, library, matters, orders, research,
                     tasks, telegram, tools, whatsapp, workspace)
from .services.llm import get_llm, llm_status
from .services.store import get_store, seed_demo

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    migrate()
    store = get_store()
    if DEMO_SEED and store.stats()["judgments"] == 0:
        seed_demo(store)
    stop, task = None, None
    if SCHEDULER:
        import asyncio
        from .services.scheduler import brief_loop
        stop = asyncio.Event()
        task = asyncio.create_task(brief_loop(stop))
    yield
    if task:
        stop.set()
        task.cancel()


app = FastAPI(title="Nyaay", version="0.5.0", lifespan=lifespan)


@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF: browsers cannot send this custom header cross-site without a CORS preflight, which we never allow.
    if request.method in UNSAFE and not request.url.path.startswith("/webhooks/"):
        if request.headers.get("x-requested-with") != "nyaai":
            return JSONResponse({"detail": "Missing X-Requested-With header"}, status_code=403)
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.path.startswith(("/auth", "/matters", "/drafts", "/firm")):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


for r in (auth.router, admin.router, integrations.router, whatsapp.router, workspace.router, research.router,
          matters.router, orders.router, tasks.router, citations.router, brief.router, library.router, tools.router, calendar_ics.router, telegram.router, features.router):
    app.include_router(r)

from .routes import system as system_routes  # noqa: E402  (system check and legal review pack)

app.include_router(system_routes.router)

STATIC = Path(__file__).resolve().parent / "static"
app.mount("/app", StaticFiles(directory=STATIC, html=True), name="ui")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/app/")


@app.get("/health")
def health():
    s = get_store().stats()
    llm = get_llm()
    from .services import vectors
    return {"ok": True, "llm": llm.name, "ai": llm_status(), "model": MODEL if llm.available else None,
            "model_fast": MODEL_FAST if llm.available else None,
            "judgments_indexed": s["judgments"], "real_judgments": s["real_judgments"],
            "index_is_fixture": s["fixture_only"],
            "integrations": {"indiankanoon": bool(INDIANKANOON_TOKEN), "ecourts": bool(ECOURTSINDIA_TOKEN),
                             "whatsapp": bool(WA_TOKEN), "semantic_search": vectors.status(get_store())["ready"]}}
