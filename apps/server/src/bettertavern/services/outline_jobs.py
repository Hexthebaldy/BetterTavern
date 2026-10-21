"""大纲修订的后台任务（docs/agent-runtime.md 第 4 节“大纲修订”）：世界状态 agent 写入一回合时，
如果还没有大纲，或者有还没处理的“大纲要改”的原因，就在同一个事务里放一个，worker 领到后交给
OutlineRunner。

和章节整理同一条 memory 队列（排序键“局 id:memory”），按顺序执行；和 state 队列互不等待。
一个任务会把到那时为止的原因一起处理，所以队列里已经有一个还没开始的任务时不再放新的。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.outline_runner import OutlineRunner

from .memory_jobs import memory_key

OUTLINE_JOB = "memory.outline"


async def enqueue_outline(conn: AsyncConnection, queue: PgJobQueue, playthrough_id: str) -> None:
    """在调用方的事务里放一个修订任务。失败不靠队列重试（还有没处理的原因时，下一回合会再放）。"""
    await queue.enqueue(
        conn,
        OUTLINE_JOB,
        memory_key(playthrough_id),
        {"playthrough_id": playthrough_id},
        max_attempts=1,
        unique_pending=True,
    )


def outline_handler(runner: OutlineRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.process(str(job.payload["playthrough_id"]))

    return handle
