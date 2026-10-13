"""内存版任务队列：语义与 infra/queue/sql.py 一致，供不需要数据库的测试使用。"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from bettertavern.infra.queue.base import FailOutcome, Job


@dataclass
class Row:
    id: int
    kind: str
    ordering_key: str
    payload: Mapping[str, Any]
    run_after: float
    max_attempts: int
    status: str = "pending"
    attempts: int = 0
    locked_by: str | None = None
    locked_at: float | None = None
    last_error: str | None = None
    history: list[str] = field(default_factory=list)


class InMemoryJobQueue:
    def __init__(self, *, lock_timeout: float = 300.0, clock: Callable[[], float] = time.monotonic):
        self.rows: dict[int, Row] = {}
        self.lock_timeout = lock_timeout
        self._clock = clock
        self._next_id = 1

    def enqueue(
        self,
        kind: str,
        ordering_key: str,
        payload: Mapping[str, Any] | None = None,
        *,
        delay: float = 0.0,
        max_attempts: int = 5,
    ) -> int:
        job_id = self._next_id
        self._next_id += 1
        self.rows[job_id] = Row(
            id=job_id,
            kind=kind,
            ordering_key=ordering_key,
            payload=dict(payload or {}),
            run_after=self._clock() + delay,
            max_attempts=max_attempts,
        )
        return job_id

    def status(self, job_id: int) -> str:
        return self.rows[job_id].status

    def _blocked(self, row: Row) -> bool:
        return any(
            other.ordering_key == row.ordering_key
            and other.status in ("pending", "running")
            and other.id < row.id
            for other in self.rows.values()
        )

    async def claim(self, worker_id: str, *, kinds: Sequence[str] | None = None) -> Job | None:
        if kinds is not None and len(kinds) == 0:
            return None
        now = self._clock()
        candidates = sorted(
            (
                row
                for row in self.rows.values()
                if row.status == "pending"
                and row.run_after <= now
                and (kinds is None or row.kind in kinds)
                and not self._blocked(row)
            ),
            key=lambda r: (r.run_after, r.id),
        )
        if not candidates:
            return None
        row = candidates[0]
        row.status = "running"
        row.locked_by = worker_id
        row.locked_at = now
        row.attempts += 1
        return Job(row.id, row.kind, row.ordering_key, row.payload, row.attempts, row.max_attempts)

    def _owned(self, job: Job, worker_id: str) -> Row | None:
        row = self.rows.get(job.id)
        if row is None or row.status != "running" or row.locked_by != worker_id:
            return None
        return row

    async def complete(self, job: Job, worker_id: str) -> bool:
        row = self._owned(job, worker_id)
        if row is None:
            return False
        row.status = "done"
        row.locked_by = row.locked_at = row.last_error = None
        return True

    async def fail(
        self, job: Job, worker_id: str, error: str, *, retry_delay: float | None
    ) -> FailOutcome:
        row = self._owned(job, worker_id)
        if row is None:
            return "lost"
        row.history.append(error)
        row.last_error = error
        row.locked_by = row.locked_at = None
        if retry_delay is not None and row.attempts < row.max_attempts:
            row.status = "pending"
            row.run_after = self._clock() + retry_delay
            return "pending"
        row.status = "failed"
        return "failed"

    async def release(self, job: Job, worker_id: str, reason: str) -> bool:
        row = self._owned(job, worker_id)
        if row is None:
            return False
        row.status = "pending"
        row.attempts = max(row.attempts - 1, 0)
        row.run_after = self._clock()
        row.locked_by = row.locked_at = None
        row.last_error = reason
        return True

    async def touch(self, job: Job, worker_id: str) -> bool:
        row = self._owned(job, worker_id)
        if row is None:
            return False
        row.locked_at = self._clock()
        return True

    async def reap(self) -> list[int]:
        now = self._clock()
        reaped: list[int] = []
        for row in self.rows.values():
            expired = row.locked_at is not None and row.locked_at < now - self.lock_timeout
            if row.status == "running" and expired:
                row.status = "pending" if row.attempts < row.max_attempts else "failed"
                row.locked_by = row.locked_at = None
                row.last_error = "lock expired: worker lost"
                reaped.append(row.id)
        return reaped
