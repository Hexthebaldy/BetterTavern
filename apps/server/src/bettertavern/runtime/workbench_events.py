"""工作台一轮 agent 的推送事件：说的话（delta）和正在写的字段（field_delta）按大约 150 毫秒攒一批，
其他事件（工具、进度、草稿变了）先把攒着的推出去再推自己，保证顺序。

事件经 WorkbenchStore.emit 写进 workbench_events 表，api 进程收到通知后推给客户端（SSE）。
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping
from typing import Any

from .ports import WorkbenchStore

BATCH_S = 0.15


class EventBatcher:
    def __init__(
        self,
        store: WorkbenchStore,
        draft_id: str,
        run_id: str,
        *,
        interval: float = BATCH_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._draft_id = draft_id
        self._run_id = run_id
        self._interval = interval
        self._clock = clock
        self._pending: list[tuple[str, dict[str, Any]]] = []
        self._last = clock()

    async def delta(self, text: str) -> None:
        if not text:
            return
        if self._pending and self._pending[-1][0] == "delta":
            self._pending[-1][1]["text"] += text
        else:
            self._pending.append(("delta", {"text": text}))
        await self._maybe_flush()

    async def field_delta(self, target: Mapping[str, Any], text: str) -> None:
        if not text:
            return
        last = self._pending[-1] if self._pending else None
        if last is not None and last[0] == "field_delta" and last[1]["target"] == dict(target):
            last[1]["text"] += text
        else:
            self._pending.append(("field_delta", {"target": dict(target), "text": text}))
        await self._maybe_flush()

    async def event(self, kind: str, data: Mapping[str, Any]) -> None:
        self._pending.append((kind, dict(data)))
        await self.flush()

    async def _maybe_flush(self) -> None:
        if self._clock() - self._last >= self._interval:
            await self.flush()

    async def flush(self) -> None:
        self._last = self._clock()
        if not self._pending:
            return
        batch, self._pending = self._pending, []
        await self._store.emit(self._draft_id, self._run_id, batch)
