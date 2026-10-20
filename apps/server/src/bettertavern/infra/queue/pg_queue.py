"""Postgres 表实现的任务队列。

入队接收调用方的连接，好让“回合提交”和“入队”在同一个事务里完成（不需要双写）；
NOTIFY 在事务提交时才送达，所以 worker 被唤醒时一定能看到新任务。
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from . import sql
from .base import FailOutcome, Job

DEFAULT_CHANNEL = "bt_jobs"


class PgJobQueue:
    def __init__(
        self,
        engine: AsyncEngine,
        *,
        channel: str = DEFAULT_CHANNEL,
        lock_timeout: float = 300.0,
    ) -> None:
        self._engine = engine
        self.channel = channel
        self.lock_timeout = lock_timeout

    async def enqueue(
        self,
        conn: AsyncConnection,
        kind: str,
        ordering_key: str,
        payload: Mapping[str, Any] | None = None,
        *,
        delay: float = 0.0,
        max_attempts: int = 5,
        unique_pending: bool = False,
    ) -> int:
        """在调用方的事务里入队并发出 NOTIFY。

        先拿该键的事务级咨询锁（见 sql.py 的说明），所以同一个键的入队会排队到前一个事务提交。
        unique_pending 为真时，这个键上已经有同类、还没开始的任务就不再入队，返回已有任务的 id。
        """
        await conn.execute(text(sql.ENQUEUE_LOCK), {"ordering_key": ordering_key})
        if unique_pending:
            existing = await conn.execute(
                text(sql.FIND_PENDING), {"kind": kind, "ordering_key": ordering_key}
            )
            found = existing.scalar_one_or_none()
            if found is not None:
                return int(found)
        result = await conn.execute(
            text(sql.ENQUEUE),
            {
                "kind": kind,
                "ordering_key": ordering_key,
                "payload": json.dumps(dict(payload or {}), ensure_ascii=False),
                "delay": float(max(delay, 0.0)),
                "max_attempts": max_attempts,
            },
        )
        job_id = int(result.scalar_one())
        await conn.execute(text(sql.NOTIFY), {"channel": self.channel, "kind": kind})
        return job_id

    async def claim(self, worker_id: str, *, kinds: Sequence[str] | None = None) -> Job | None:
        if kinds is not None and len(kinds) == 0:
            return None
        statement = sql.CLAIM_KINDS if kinds else sql.CLAIM_ANY
        params: dict[str, Any] = {"worker": worker_id}
        if kinds:
            params["kinds"] = list(kinds)
        async with self._engine.begin() as conn:
            row = (await conn.execute(text(statement), params)).mappings().first()
        if row is None:
            return None
        return Job(
            id=int(row["id"]),
            kind=str(row["kind"]),
            ordering_key=str(row["ordering_key"]),
            payload=json.loads(row["payload"]),
            attempts=int(row["attempts"]),
            max_attempts=int(row["max_attempts"]),
        )

    async def complete(self, job: Job, worker_id: str) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(text(sql.COMPLETE), {"id": job.id, "worker": worker_id})
            return result.rowcount == 1

    async def fail(
        self, job: Job, worker_id: str, error: str, *, retry_delay: float | None
    ) -> FailOutcome:
        params = {
            "id": job.id,
            "worker": worker_id,
            "retry": retry_delay is not None,
            "delay": float(max(retry_delay or 0.0, 0.0)),
            "error": error[:2000],
        }
        async with self._engine.begin() as conn:
            status = (await conn.execute(text(sql.FAIL), params)).scalar_one_or_none()
        if status is None:
            return "lost"
        return "pending" if status == "pending" else "failed"

    async def release(self, job: Job, worker_id: str, reason: str) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(
                text(sql.RELEASE), {"id": job.id, "worker": worker_id, "reason": reason[:2000]}
            )
            return result.rowcount == 1

    async def touch(self, job: Job, worker_id: str) -> bool:
        async with self._engine.begin() as conn:
            result = await conn.execute(text(sql.TOUCH), {"id": job.id, "worker": worker_id})
            return result.rowcount == 1

    async def reap(self) -> list[int]:
        async with self._engine.begin() as conn:
            rows = await conn.execute(text(sql.REAP), {"lock_timeout": float(self.lock_timeout)})
            return [int(r[0]) for r in rows]
