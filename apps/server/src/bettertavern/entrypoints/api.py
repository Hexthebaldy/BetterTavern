"""组装根：create_app() 装配路由、中间件和生命周期。唯一允许 import 所有层的地方。"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import socket
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

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
from bettertavern.api.v1.auth import router as auth_router
from bettertavern.api.v1.credentials import router as credentials_router
from bettertavern.api.v1.health import router as health_router
from bettertavern.api.v1.playthroughs import router as playthroughs_router
from bettertavern.api.v1.scenarios import router as scenarios_router
from bettertavern.importers.character_card import MAX_UPLOAD_BYTES
from bettertavern.infra.crypto.keyring import load_secrets
from bettertavern.infra.db.engine import create_engine
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.providers.limiter import CredentialLimiter, LimiterConfig
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.probe_service import ProbeService
from bettertavern.settings import Settings

log = logging.getLogger(__name__)


async def _every(interval: float, job: Callable[[], Awaitable[object]], name: str) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await job()
        except Exception:
            log.warning("定时任务 %s 失败", name, exc_info=True)


def instance_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def build_app_services(
    settings: Settings,
    buffers: EventBufferRegistry,
    *,
    engine: AsyncEngine | None = None,
    hub: ProviderHub | None = None,
) -> Services:
    secrets = load_secrets(
        master_keys=settings.master_keys.get_secret_value() if settings.master_keys else None,
        auth_secret=settings.auth_secret.get_secret_value() if settings.auth_secret else None,
        allow_dev_fallback=not settings.is_prod,
        data_dir=settings.data_dir,
    )
    if secrets.generated_dev_file is not None:
        log.warning(
            "开发环境：使用自动生成的密钥 %s（生产环境必须配置）", secrets.generated_dev_file
        )
    policy = EndpointPolicy(allow_private=settings.allow_private_endpoints)
    hub = hub or ProviderHub(
        policy=policy,
        proxy=settings.outbound_proxy,
        limiter=CredentialLimiter(LimiterConfig(capacity=settings.credential_concurrency)),
        user_agent=f"BetterTavern/{__version__}",
    )
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
            barrier_timeout_s=settings.state_barrier_timeout_s,
            world_builder_timeout_s=settings.world_builder_timeout_s,
            options_repair_timeout_s=settings.options_repair_timeout_s,
        ),
        instance_id=instance_id(),
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
            asyncio.create_task(_every(60.0, _sweep(buffers), "清理事件缓冲")),
            asyncio.create_task(_every(15.0, services.maintenance.tick, "清理租约")),
        ]
        try:
            yield
        finally:
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
        BodySizeLimit, limits={"/v1/scenarios/import": MAX_UPLOAD_BYTES + 256 * 1024}
    )
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["Retry-After"],
        )
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(credentials_router)
    app.include_router(scenarios_router)
    app.include_router(playthroughs_router)
    if settings.probe_endpoints_enabled:
        app.mount("/v1/probe", create_probe_app(probe, shutdown=shutdown.event))
    return app


def _sweep(buffers: EventBufferRegistry) -> Callable[[], Awaitable[None]]:
    async def run() -> None:
        removed = buffers.sweep()
        if removed:
            log.debug("清理了 %d 个过期的事件流", removed)

    return run
