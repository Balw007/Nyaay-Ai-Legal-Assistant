"""Background loop that sends the morning brief while the server runs. Switch off with NYAAY_SCHEDULER=0."""
from __future__ import annotations

import asyncio
import logging

from ..db import SessionLocal

log = logging.getLogger("nyaay.scheduler")


def _tick() -> None:
    from .brief_delivery import deliver_due

    with SessionLocal() as db:
        deliver_due(db)


async def brief_loop(stop: asyncio.Event, every: float = 60.0) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(_tick)
        except Exception:  # never let a brief problem take the app down
            log.exception("morning brief tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=every)
        except asyncio.TimeoutError:
            pass
