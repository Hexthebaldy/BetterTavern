"""任务队列的接口。v1 用 Postgres 表实现，以后可以换成 Taskiq 或 Redis。"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

FailOutcome = Literal["pending", "failed", "lost"]


@dataclass(frozen=True, slots=True)
class Job:
    id: int
    kind: str
    ordering_key: str
    payload: Mapping[str, Any] = field(default_factory=dict)
    attempts: int = 1
    max_attempts: int = 5

    @property
    def exhausted(self) -> bool:
        return self.attempts >= self.max_attempts


class JobQueue(Protocol):
    lock_timeout: float

    async def claim(self, worker_id: str, *, kinds: Sequence[str] | None = None) -> Job | None:
        """领取一个可执行的任务；没有就返回 None。"""
        ...

    async def complete(self, job: Job, worker_id: str) -> bool:
        """标记完成；返回 False 说明任务已不归这个 worker（锁超时被回收）。"""
        ...

    async def fail(
        self, job: Job, worker_id: str, error: str, *, retry_delay: float | None
    ) -> FailOutcome:
        """标记失败；retry_delay 为 None 表示不再重试。"""
        ...

    async def release(self, job: Job, worker_id: str, reason: str) -> bool:
        """优雅退出时归还没跑完的任务：不消耗重试次数，立即可被领取。"""
        ...

    async def touch(self, job: Job, worker_id: str) -> bool:
        """续锁（长任务的心跳）。"""
        ...

    async def reap(self) -> list[int]:
        """回收锁超时的任务，返回被回收的任务 id。"""
        ...
