"""章节整理的后台任务：世界状态 agent 每整理完（或跳过）一回合，在同一个事务里放一个，
worker 领到后交给 MemoryRunner，由它看够不够切一章（docs/agent-runtime.md 第 3 节“后台”）。

每局一条 memory 队列（排序键“局 id:memory”），和 state 队列分开，互不等待：写一章要几十秒，
不能让下一回合的世界状态整理排在它后面。一个任务会把够切的章节都写完，所以队列里已经有一个
还没开始的任务时不再放新的。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.memory_runner import MemoryRunner

MEMORY_JOB = "memory.chapter"


def memory_key(playthrough_id: str) -> str:
    return f"{playthrough_id}:memory"


async def enqueue_memory(conn: AsyncConnection, queue: PgJobQueue, playthrough_id: str) -> None:
    """在调用方的事务里放一个整理任务。失败不靠队列重试（下一回合整理完会再放一个）。"""
    await queue.enqueue(
        conn,
        MEMORY_JOB,
        memory_key(playthrough_id),
        {"playthrough_id": playthrough_id},
        max_attempts=1,
        unique_pending=True,
    )


def memory_handler(runner: MemoryRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.process(str(job.payload["playthrough_id"]))

    return handle
