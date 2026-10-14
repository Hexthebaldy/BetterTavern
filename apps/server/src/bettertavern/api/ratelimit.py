"""进程内的滑动窗口限流（单实例够用；多实例部署时换成 Redis 实现）。"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    def __init__(
        self,
        limit: int,
        window_s: float = 60.0,
        *,
        max_keys: int = 50_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.limit = limit
        self.window = window_s
        self._max_keys = max_keys
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def hit(self, key: str) -> float | None:
        """记一次请求；超限时返回需要等待的秒数，否则返回 None。"""
        now = self._clock()
        hits = self._hits.get(key)
        if hits is None:
            if len(self._hits) >= self._max_keys:
                self._prune(now)
            hits = self._hits[key] = deque()
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            return hits[0] + self.window - now
        hits.append(now)
        return None

    def _prune(self, now: float) -> None:
        stale = [k for k, v in self._hits.items() if not v or v[-1] <= now - self.window]
        for key in stale:
            del self._hits[key]
        if len(self._hits) >= self._max_keys:  # 全是活跃键：丢掉最早的一半
            for key in list(self._hits)[: self._max_keys // 2]:
                del self._hits[key]
