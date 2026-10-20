"""世界状态整理的后台任务：回合存好时在同一个事务里放进队列，worker 领到后交给 StateRunner。

每局一条 state 队列（排序键“局 id:state”），同一局的任务按顺序执行。一个任务会把这一局所有还没整理的
回合依次整理完，所以队列里已经有一个还没开始的任务时不再放新的。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.state_runner import StateRunner

STATE_JOB = "state.turn"


def state_key(playthrough_id: str) -> str:
    return f"{playthrough_id}:state"


async def enqueue_state(conn: AsyncConnection, queue: PgJobQueue, playthrough_id: str) -> None:
    """在调用方的事务里放一个整理任务。整理失败不靠队列重试（下一回合的任务会再从它开始）。"""
    await queue.enqueue(
        conn,
        STATE_JOB,
        state_key(playthrough_id),
        {"playthrough_id": playthrough_id},
        max_attempts=1,
        unique_pending=True,
    )


def state_handler(runner: StateRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.process(str(job.payload["playthrough_id"]))

    return handle
