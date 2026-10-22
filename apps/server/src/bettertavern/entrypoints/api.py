"""组装根：create_app() 装配路由、中间件和生命周期。唯一允许 import 所有层的地方。"""

from __future__ import annotations

import asyncio
import contextlib
import os
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern import __version__
from bettertavern.api.body_limit import BodySizeLimit
from bettertavern.api.deps import Limiters
from bettertavern.api.errors import install_error_handlers
from bettertavern.api.lifecycle import Shutdown
from bettertavern.api.probe_app import create_probe_app
from bettertavern.api.ratelimit import RateLimiter
from bettertavern.api.request_context import RequestContext
from bettertavern.api.v1.auth import router as auth_router
from bettertavern.api.v1.cards import router as cards_router
from bettertavern.api.v1.health import router as health_router
from bettertavern.api.v1.playthroughs import router as playthroughs_router
from bettertavern.api.v1.routes import router as routes_router
from bettertavern.api.v1.scenarios import router as scenarios_router
from bettertavern.api.v1.tools import router as tools_router
from bettertavern.api.v1.workbench import (
    ASSET_PATH_PATTERN,
    CARD_PATH_PATTERN,
    IMPORT_PATH,
    MAX_CARD_BODY_BYTES,
)
from bettertavern.api.v1.workbench import router as workbench_router
from bettertavern.importers.character_card import MAX_UPLOAD_BYTES
from bettertavern.importers.images import MAX_IMAGE_BYTES
from bettertavern.infra.db.engine import create_engine
from bettertavern.providers import ProviderHub
from bettertavern.providers.transport import build_http_client
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.probe_service import ProbeService
from bettertavern.settings import Settings

from .bootstrap import app_secrets, endpoint_policy, provider_hub
from .logging_setup import setup_logging

log = structlog.get_logger(__name__)


async def _every(interval: float, job: Callable[[], Awaitable[object]], name: str) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await job()
        except Exception:
            log.warning("scheduler.task_failed", task=name, exc_info=True)


def instance_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def build_app_services(
    settings: Settings,
    buffers: EventBufferRegistry,
    *,
    engine: AsyncEngine | None = None,
    hub: ProviderHub | None = None,
) -> Services:
    secrets = app_secrets(settings)
    policy = endpoint_policy(settings)
    hub = hub or provider_hub(settings, policy)
    return build_services(
        engine=engine or create_engine(settings.database_url),
        secrets=secrets,
        hub=hub,
        policy=policy,
        buffers=buffers,
        access_ttl_s=settings.access_token_ttl_s,
        refresh_ttl_s=settings.refresh_token_ttl_s,
        runner_config=RunnerConfig(
            lease_ttl_s=settings.turn_lease_s,
            lease_renew_s=settings.turn_lease_renew_s,
            world_builder_timeout_s=settings.world_builder_timeout_s,
            options_repair_timeout_s=settings.options_repair_timeout_s,
            director_timeout_s=settings.director_timeout_s,
        ),
        instance_id=instance_id(),
        rollback_limit=settings.rollback_limit,
        http=build_http_client(policy, proxy=settings.outbound_proxy),
    )


def create_app(
    settings: Settings | None = None,
    *,
    shutdown: Shutdown | None = None,
    services: Services | None = None,
) -> FastAPI:
    settings = settings or Settings()
    shutdown = shutdown or Shutdown()
    buffers = (
        services.buffers
        if services is not None
        else EventBufferRegistry(retention=settings.event_buffer_retention_s)
    )
    services = services or build_app_services(settings, buffers)
    probe = ProbeService(buffers)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        shutdown.bind(asyncio.get_running_loop())
        background = [
            asyncio.create_task(_every(60.0, _sweep(buffers), "sweep_event_buffers")),
            asyncio.create_task(_every(15.0, services.maintenance.tick, "sweep_leases")),
        ]
        log.info("app.started", version=__version__, env=settings.env, instance=instance_id())
        try:
            yield
        finally:
            log.info("app.stopping", grace_s=settings.shutdown_grace_s)
            shutdown.trigger()
            for task in background:
                task.cancel()
            for task in background:
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await services.aclose(grace=settings.shutdown_grace_s)
            await probe.aclose()
            await services.engine.dispose()

    app = FastAPI(
        title="BetterTavern API",
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.shutdown = shutdown
    app.state.buffers = buffers
    app.state.services = services
    app.state.limiters = Limiters(
        auth=RateLimiter(settings.rate_limit_auth_per_min),
        turns=RateLimiter(settings.rate_limit_turns_per_min),
        probe=RateLimiter(settings.rate_limit_probe_per_min),
    )
    install_error_handlers(app)
    # 角色卡上传另算：16 MB 的文件加上 multipart 的边界和头
    app.add_middleware(
        BodySizeLimit,
        limits={IMPORT_PATH: MAX_UPLOAD_BYTES + 256 * 1024},
        patterns=[
            (CARD_PATH_PATTERN, MAX_CARD_BODY_BYTES),
            (ASSET_PATH_PATTERN, MAX_IMAGE_BYTES + 256 * 1024),
        ],
    )
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Retry-After", "X-Request-ID"],
        )
    # 最后加的在最外层：请求单号、访问日志、未处理的异常要包住其他所有中间件
    app.add_middleware(RequestContext)
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(routes_router)
    app.include_router(cards_router)
    app.include_router(scenarios_router)
    app.include_router(workbench_router)
    app.include_router(tools_router)
    app.include_router(playthroughs_router)
    if settings.probe_endpoints_enabled:
        app.mount("/v1/probe", create_probe_app(probe, shutdown=shutdown.event))
    return app


def _sweep(buffers: EventBufferRegistry) -> Callable[[], Awaitable[None]]:
    async def run() -> None:
        removed = buffers.sweep()
        if removed:
            log.debug("events.swept", removed=removed)

    return run


def create_dev_app() -> FastAPI:
    """开发时自动重启用的工厂：重启出来的进程里没有经过命令行，日志要在这里配"""
    settings = Settings()
    setup_logging(settings, "api")
    return create_app(settings)
