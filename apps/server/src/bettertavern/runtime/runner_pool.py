"""进程内的回合执行器池：每个回合一个后台任务，持有它的事件流与取消令牌。"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from bettertavern.providers import CancelToken

from .events.buffer import EventBufferRegistry, EventStream
from .ports import TurnHeader

if TYPE_CHECKING:
    from .runner import TurnRunner


class TurnRunnerPool:
    """进程内的回合执行器：每个回合一个后台任务，持有它的事件流与取消令牌。"""

    def __init__(self, runner: TurnRunner, buffers: EventBufferRegistry) -> None:
        self._runner = runner
        self._buffers = buffers
        self._running: dict[str, tuple[asyncio.Task[None], CancelToken]] = {}

    def start(self, header: TurnHeader) -> EventStream:
        """同步创建事件流（返回 201 之前），客户端随后订阅一定能找到它。"""
        stream = self._buffers.create(header.turn_id)
        token = CancelToken()
        task = asyncio.create_task(self._runner.run(header, stream, token))
        self._running[header.turn_id] = (task, token)
        task.add_done_callback(lambda _t, tid=header.turn_id: self._running.pop(tid, None))
        return stream

    def is_running(self, turn_id: str) -> bool:
        return turn_id in self._running

    def cancel(self, turn_id: str, reason: str = "user") -> bool:
        entry = self._running.get(turn_id)
        if entry is None:
            return False
        entry[1].cancel(reason)
        return True

    def __len__(self) -> int:
        return len(self._running)

    async def shutdown(self, grace: float) -> None:
        """优雅退出：先等进行中的回合最多 grace 秒，再取消剩下的（回合置为失败，可重试）。"""
        tasks = [task for task, _ in self._running.values()]
        if not tasks:
            return
        _, pending = await asyncio.wait(tasks, timeout=grace)
        for task, token in list(self._running.values()):
            if task in pending:
                token.cancel("shutdown")
        if pending:
            _, still = await asyncio.wait(pending, timeout=5.0)
            for task in still:
                task.cancel()
            if still:
                await asyncio.wait(still, timeout=2.0)
