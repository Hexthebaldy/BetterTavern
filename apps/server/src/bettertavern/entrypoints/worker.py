"""worker 进程：领取任务，按 kind 分派。

M0 只有队列原型和一个 noop 处理器（冒烟用）；state / summary / outline 三条车道的处理器
在 M2、M3 接入 services/pipeline_service.py。
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket

from bettertavern.infra.db.engine import create_engine
from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.notify import PgNotifyListener
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler, JobWorker
from bettertavern.settings import Settings

log = logging.getLogger(__name__)


async def noop(job: Job) -> None:
    log.info("noop 任务 %s：%s", job.id, dict(job.payload))


def handlers() -> dict[str, Handler]:
    return {"noop": noop}


async def run_worker(settings: Settings) -> None:
    engine = create_engine(settings.database_url)
    queue = PgJobQueue(engine, lock_timeout=settings.job_lock_timeout_s)
    listener = PgNotifyListener(engine, queue.channel)
    await listener.start()
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    registered = handlers()
    worker = JobWorker(
        queue,
        registered,
        worker_id=worker_id,
        concurrency=settings.worker_concurrency,
        shutdown_grace=settings.worker_shutdown_grace_s,
        wakeup=listener.event,
        kinds=list(registered),  # 只领取自己能处理的 kind
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker %s 已启动，处理：%s", worker_id, ", ".join(registered))
    try:
        await worker.run(stop)
    finally:
        await listener.stop()
        await engine.dispose()
        log.info("worker %s 已退出", worker_id)
