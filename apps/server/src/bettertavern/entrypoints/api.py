"""组装根：create_app() 装配路由、中间件和生命周期。唯一允许 import 所有层的地方。"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from bettertavern import __version__
from bettertavern.api.lifecycle import Shutdown
from bettertavern.api.probe_app import create_probe_app
from bettertavern.api.v1.health import router as health_router
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.services.probe_service import ProbeService
from bettertavern.settings import Settings

log = logging.getLogger(__name__)


async def _sweep_buffers(buffers: EventBufferRegistry, interval: float) -> None:
    while True:
        await asyncio.sleep(interval)
        removed = buffers.sweep()
        if removed:
            log.debug("清理了 %d 个过期的事件流", removed)


def create_app(settings: Settings | None = None, *, shutdown: Shutdown | None = None) -> FastAPI:
    settings = settings or Settings()
    shutdown = shutdown or Shutdown()
    buffers = EventBufferRegistry(retention=settings.event_buffer_retention_s)
    probe = ProbeService(buffers)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        shutdown.bind(asyncio.get_running_loop())
        sweeper = asyncio.create_task(_sweep_buffers(buffers, 60.0))
        try:
            yield
        finally:
            shutdown.trigger()
            sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await sweeper
            await probe.aclose()

    app = FastAPI(
        title="BetterTavern API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/docs",
    )
    app.state.settings = settings
    app.state.shutdown = shutdown
    app.state.buffers = buffers
    app.include_router(health_router)
    if settings.probe_endpoints_enabled:
        app.mount("/v1/probe", create_probe_app(probe, shutdown=shutdown.event))
    return app
