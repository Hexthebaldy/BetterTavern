"""每个凭据的并发限流。

默认 4 个并发，其中 1 个槽位留给交互请求（导演）；后台任务（StateKeeper、压缩、门控）只能用
其余的槽位，排队超时就推迟。收到 429 后记录冷却时间，期间新请求先等。
目的是保护用户自己的额度、避免后台任务挤占交互请求，不是为了顶住厂商上限。
v1 是进程内实现；多个进程共用一把密钥时可换成 Redis 信号量。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass


class LimiterTimeout(Exception):
    """排队超时：后台任务应推迟，交互请求应提示稍后再试。"""


@dataclass(frozen=True, slots=True)
class LimiterConfig:
    capacity: int = 4
    reserved_interactive: int = 1

    def __post_init__(self) -> None:
        if self.capacity < 1:
            raise ValueError("capacity must be at least 1")
        if not 0 <= self.reserved_interactive < self.capacity:
            raise ValueError("reserved_interactive must be less than capacity")


class _CredentialPool:
    def __init__(self, config: LimiterConfig) -> None:
        self.config = config
        self.in_use = 0
        self.background_in_use = 0
        self.cooldown_until = 0.0
        self.condition = asyncio.Condition()

    def can_enter(self, interactive: bool) -> bool:
        if self.in_use >= self.config.capacity:
            return False
        if interactive:
            return True
        return self.background_in_use < self.config.capacity - self.config.reserved_interactive


class CredentialLimiter:
    def __init__(
        self,
        config: LimiterConfig | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._config = config or LimiterConfig()
        self._clock = clock
        self._pools: dict[str, _CredentialPool] = {}

    def _pool(self, credential_id: str) -> _CredentialPool:
        pool = self._pools.get(credential_id)
        if pool is None:
            pool = self._pools[credential_id] = _CredentialPool(self._config)
        return pool

    def note_rate_limited(self, credential_id: str, retry_after: float | None) -> None:
        pool = self._pool(credential_id)
        until = self._clock() + (retry_after if retry_after is not None else 5.0)
        pool.cooldown_until = max(pool.cooldown_until, until)

    def in_use(self, credential_id: str) -> int:
        return self._pool(credential_id).in_use

    @asynccontextmanager
    async def slot(
        self, credential_id: str, *, interactive: bool, timeout: float | None = None
    ) -> AsyncIterator[None]:
        pool = self._pool(credential_id)
        deadline = None if timeout is None else self._clock() + timeout

        def remaining() -> float | None:
            return None if deadline is None else max(deadline - self._clock(), 0.0)

        wait = pool.cooldown_until - self._clock()
        if wait > 0:
            left = remaining()
            if left is not None and wait > left:
                raise LimiterTimeout("The credential is cooling down after rate limiting")
            await asyncio.sleep(wait)
        try:
            async with pool.condition:
                await asyncio.wait_for(
                    pool.condition.wait_for(lambda: pool.can_enter(interactive)), remaining()
                )
                pool.in_use += 1
                if not interactive:
                    pool.background_in_use += 1
        except TimeoutError as exc:
            raise LimiterTimeout("Timed out waiting for a concurrency slot") from exc
        try:
            yield
        finally:
            async with pool.condition:
                pool.in_use -= 1
                if not interactive:
                    pool.background_in_use -= 1
                pool.condition.notify_all()
