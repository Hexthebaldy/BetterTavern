"""收到退出信号后，SSE 连接要很快结束，服务器才能在宽限期内退出。"""

from __future__ import annotations

import asyncio
import signal
import threading
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
import uvicorn
from starlette.applications import Starlette
from starlette.routing import Mount

from bettertavern.api.lifecycle import Shutdown
from bettertavern.api.probe_app import create_probe_app
from bettertavern.entrypoints.server import GracefulServer
from bettertavern.providers.sse_parser import SseDecoder
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.services.probe_service import ProbeService

pytestmark = pytest.mark.anyio


def build_server(shutdown: Shutdown) -> GracefulServer:
    service = ProbeService(EventBufferRegistry())

    @asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        shutdown.bind(asyncio.get_running_loop())
        yield
        await service.aclose()

    app = Starlette(
        routes=[Mount("/v1/probe", app=create_probe_app(service, shutdown=shutdown.event))],
        lifespan=lifespan,
    )
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        log_level="critical",
        lifespan="on",
        timeout_graceful_shutdown=30,
    )
    return GracefulServer(config, shutdown)


async def test_sse_streams_end_promptly_on_sigterm() -> None:
    shutdown = Shutdown()
    server = build_server(shutdown)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}/v1/probe"

    async with httpx.AsyncClient(timeout=10) as client:
        created = await client.post(f"{base}/streams", json={"duration_s": 60})
        stream_id = created.json()["stream_id"]
        decoder = SseDecoder()
        received = 0
        started = time.monotonic()
        async with client.stream("GET", f"{base}/streams/{stream_id}/events") as response:
            async for chunk in response.aiter_bytes():
                received += len(decoder.feed(chunk))
                if received >= 3 and not shutdown.triggered:
                    server.handle_exit(signal.SIGTERM, None)  # 模拟收到 SIGTERM
        ended_after = time.monotonic() - started

    assert received >= 3
    assert shutdown.triggered
    assert ended_after < 5  # 远早于 60 秒的探针结束，也远早于 30 秒的宽限期
    thread.join(timeout=10)
    assert not thread.is_alive()
