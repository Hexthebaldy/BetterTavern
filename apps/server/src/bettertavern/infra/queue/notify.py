"""LISTEN/NOTIFY 唤醒：在一个专用连接上 LISTEN，收到通知就置位事件。

连接断了（例如数据库重启）会定期检查并重连；重连之间漏掉的通知由 worker 的轮询兜底，
重连成功后也会补一次唤醒。
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

log = structlog.get_logger(__name__)


class PgNotifyListener:
    def __init__(
        self,
        engine: AsyncEngine,
        channel: str,
        *,
        check_interval: float = 5.0,
    ) -> None:
        self._engine = engine
        self._channel = channel
        self._check_interval = check_interval
        self._conn: AsyncConnection | None = None
        self._driver: Any = None  # asyncpg.Connection
        self._supervisor: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()
        self.event = asyncio.Event()

    async def start(self) -> None:
        try:
            await self._connect()
        except Exception:
            # 先靠轮询，稍后重试
            log.warning("queue.listen_failed", channel=self._channel, exc_info=True)
        self._supervisor = asyncio.create_task(self._supervise())

    async def stop(self) -> None:
        self._stopping.set()
        if self._supervisor is not None:
            self._supervisor.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._supervisor
        await self._disconnect()

    def _on_notify(self, connection: Any, pid: int, channel: str, payload: str) -> None:
        self.event.set()

    async def _connect(self) -> None:
        conn = await self._engine.connect()
        try:
            raw = await conn.get_raw_connection()
            driver = raw.driver_connection
            if driver is None:
                raise RuntimeError("Can't get the underlying asyncpg connection")
            await driver.add_listener(self._channel, self._on_notify)
        except BaseException:
            with contextlib.suppress(Exception):
                await conn.close()
            raise
        self._conn = conn
        self._driver = driver
        self.event.set()  # 断线期间可能漏了通知，补一次唤醒

    async def _disconnect(self) -> None:
        driver, conn = self._driver, self._conn
        self._driver = None
        self._conn = None
        if driver is not None and not driver.is_closed():
            with contextlib.suppress(Exception):
                await driver.remove_listener(self._channel, self._on_notify)
        if conn is not None:
            with contextlib.suppress(Exception):
                await conn.close()

    async def _supervise(self) -> None:
        while not self._stopping.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._stopping.wait(), timeout=self._check_interval)
            if self._stopping.is_set():
                return
            if self._driver is not None and not self._driver.is_closed():
                continue
            await self._disconnect()
            try:
                await self._connect()
                log.info("queue.listen_restored", channel=self._channel)
            except Exception:
                log.warning("queue.listen_retry_failed", channel=self._channel, exc_info=True)
