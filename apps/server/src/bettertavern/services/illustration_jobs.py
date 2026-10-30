"""故事配图的后台任务（docs/illustrations.md 第 2 节）：玩家点“画这一幕”时，插入那一行的事务里
放一个 story.image 任务；worker 领到后交给 IllustrationRunner 画。

每张图一条队列（排序键“图 id:image”），几张图可以同时画。不重试（max_attempts 为 1）：
重画一次要再花一次出图的钱，交给玩家点“再试一次”；超过时限没画完的读的时候按失败显示。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler
from bettertavern.runtime.illustration_runner import IllustrationRunner

IMAGE_JOB = "story.image"


async def enqueue_image(conn: AsyncConnection, queue: PgJobQueue, image_id: str) -> None:
    await queue.enqueue(
        conn, IMAGE_JOB, f"{image_id}:image", {"image_id": image_id}, max_attempts=1
    )


def image_handler(runner: IllustrationRunner) -> Handler:
    async def handle(job: Job) -> None:
        await runner.process(str(job.payload["image_id"]))

    return handle
