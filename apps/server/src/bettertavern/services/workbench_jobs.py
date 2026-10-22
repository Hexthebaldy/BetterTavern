"""工作台 agent 的后台任务：api 写好用户的消息、把草稿改成 running 时，在同一个事务里放一个
workbench.run 任务；worker 领到后交给 WorkbenchRunner 跑一轮。

每份草稿一条队列（排序键“草稿 id:workbench”）。不重试（max_attempts 为 1）：跑到一半进程挂了，
重跑会重复搜索、重复出图；这一轮记失败（心跳过期后草稿可以重新开一轮）。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.workbench_runner import WorkbenchRunner

WORKBENCH_JOB = "workbench.run"


def workbench_key(draft_id: str) -> str:
    return f"{draft_id}:workbench"


async def enqueue_workbench(
    conn: AsyncConnection, queue: PgJobQueue, draft_id: str, run_id: str, trigger: str
) -> None:
    await queue.enqueue(
        conn,
        WORKBENCH_JOB,
        workbench_key(draft_id),
        {"draft_id": draft_id, "run_id": run_id, "trigger": trigger},
        max_attempts=1,
    )


def workbench_handler(runner: WorkbenchRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.run(str(job.payload["draft_id"]), str(job.payload["run_id"]))

    return handle
