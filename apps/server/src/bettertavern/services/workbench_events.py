"""api 进程里推工作台事件：一条专用连接 LISTEN bt_workbench，通知的内容是草稿 id，
收到后叫醒订阅了这份草稿的 SSE 连接，由它们去 workbench_events 表里读新事件。

连接断了（例如数据库重启）时，订阅者靠每 2 秒的轮询兜底，下次订阅时再重连。
"""

from __future__ import annotations

import asyncio
import contextlib
from collections import defaultdict
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.infra.db.repositories.workbench import NOTIFY_CHANNEL

log = structlog.get_logger(__name__)

POLL_S = 2.0


class WorkbenchEventHub:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        self._waiters: dict[str, set[asyncio.Event]] = defaultdict(set)
        self._conn: AsyncConnection | None = None
        self._driver: Any = None
        self._lock = asyncio.Lock()

    def _on_notify(self, connection: Any, pid: int, channel: str, payload: str) -> None:
        for event in self._waiters.get(payload, ()):
            event.set()

    async def _ensure_listening(self) -> None:
        if self._driver is not None and not self._driver.is_closed():
            return
        async with self._lock:
            if self._driver is not None and not self._driver.is_closed():
                return
            await self._close()
            try:
                conn = await self._engine.connect()
                raw = await conn.get_raw_connection()
                driver = raw.driver_connection
                if driver is None:
                    raise RuntimeError("Can't get the underlying asyncpg connection")
                await driver.add_listener(NOTIFY_CHANNEL, self._on_notify)
            except Exception:
                log.warning("workbench.listen_failed", exc_info=True)
                return
            self._conn, self._driver = conn, driver

    async def _close(self) -> None:
        driver, conn = self._driver, self._conn
        self._driver = self._conn = None
        if driver is not None and not driver.is_closed():
            with contextlib.suppress(Exception):
                await driver.remove_listener(NOTIFY_CHANNEL, self._on_notify)
        if conn is not None:
            with contextlib.suppress(Exception):
                await conn.close()

    async def subscribe(self, draft_id: str) -> asyncio.Event:
        await self._ensure_listening()
        event = asyncio.Event()
        self._waiters[draft_id].add(event)
        return event

    def unsubscribe(self, draft_id: str, event: asyncio.Event) -> None:
        waiters = self._waiters.get(draft_id)
        if waiters is None:
            return
        waiters.discard(event)
        if not waiters:
            del self._waiters[draft_id]

    async def wait(self, event: asyncio.Event) -> None:
        """等到有通知，或者最多 POLL_S 秒（兜底轮询）。"""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(event.wait(), timeout=POLL_S)
        event.clear()

    async def aclose(self) -> None:
        await self._close()
