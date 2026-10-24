"""闪电模式的压缩任务：闪电模式的回合存好时在同一个事务里放一个，worker 领到后交给 LightningRunner，
由它看原文够不够压（docs/agent-runtime.md 的“闪电模式”）。不到阈值就什么都不做，不调模型。

和章节整理在同一条 memory 队列里（排序键“局 id:memory”）：同一局的压缩一个接一个跑。
一个任务按当时的头部回合看，所以队列里已经有一个还没开始的任务时不再放新的。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.lightning_runner import LightningRunner

from .memory_jobs import memory_key

LIGHTNING_JOB = "memory.lightning"


async def enqueue_lightning(conn: AsyncConnection, queue: PgJobQueue, playthrough_id: str) -> None:
    """在调用方的事务里放一个压缩任务。失败不靠队列重试（下一回合存好时会再放一个）。"""
    await queue.enqueue(
        conn,
        LIGHTNING_JOB,
        memory_key(playthrough_id),
        {"playthrough_id": playthrough_id},
        max_attempts=1,
        unique_pending=True,
    )


def lightning_handler(runner: LightningRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.process(str(job.payload["playthrough_id"]))

    return handle
