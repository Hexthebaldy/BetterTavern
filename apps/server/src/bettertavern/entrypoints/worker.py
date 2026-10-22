"""worker 进程：领取后台任务，按 kind 分派。

现在有五种任务：state.turn（世界状态 agent 整理一局还没整理的回合，services/state_jobs.py）、
memory.chapter（章节整理，services/memory_jobs.py）、memory.outline（大纲修订，
services/outline_jobs.py）、workbench.run（工作台 agent 跑一轮，services/workbench_jobs.py）
和 noop（冒烟用）。只领取自己有处理器的 kind，
新旧版本的 worker 可以同时运行。
"""

from __future__ import annotations

import asyncio
import os
import signal
import socket

import structlog

from bettertavern.domain.memory.chapters import ChapterRule
from bettertavern.infra.db.engine import create_engine
from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.notify import PgNotifyListener
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.infra.queue.worker import Handler, JobWorker
from bettertavern.providers.transport import build_http_client
from bettertavern.runtime.memory_runner import MemoryRunner, MemoryRunnerConfig
from bettertavern.runtime.outline_runner import OutlineRunner
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig
from bettertavern.runtime.workbench_runner import WorkbenchRunner
from bettertavern.services.container import (
    build_memory_runner,
    build_outline_runner,
    build_state_runner,
    build_workbench_runner,
)
from bettertavern.services.memory_jobs import MEMORY_JOB, memory_handler
from bettertavern.services.outline_jobs import OUTLINE_JOB, outline_handler
from bettertavern.services.state_jobs import STATE_JOB, state_handler
from bettertavern.services.workbench_jobs import WORKBENCH_JOB, workbench_handler
from bettertavern.settings import Settings

from .bootstrap import app_secrets, endpoint_policy, provider_hub

log = structlog.get_logger(__name__)


async def noop(job: Job) -> None:
    log.info("job.noop", payload_keys=sorted(job.payload))


def handlers(
    state: StateRunner,
    memory: MemoryRunner,
    outline: OutlineRunner,
    workbench: WorkbenchRunner | None = None,
) -> dict[str, Handler]:
    registered: dict[str, Handler] = {
        "noop": noop,
        STATE_JOB: state_handler(state),
        MEMORY_JOB: memory_handler(memory),
        OUTLINE_JOB: outline_handler(outline),
    }
    if workbench is not None:
        registered[WORKBENCH_JOB] = workbench_handler(workbench)
    return registered


async def run_worker(settings: Settings) -> None:
    engine = create_engine(settings.database_url)
    policy = endpoint_policy(settings)
    hub = provider_hub(settings, policy)
    state = build_state_runner(
        engine=engine,
        secrets=app_secrets(settings),
        hub=hub,
        policy=policy,
        config=StateRunnerConfig(turn_timeout_s=settings.state_turn_timeout_s),
    )
    memory = build_memory_runner(
        engine=engine,
        secrets=app_secrets(settings),
        hub=hub,
        policy=policy,
        config=MemoryRunnerConfig(
            rule=ChapterRule(settings.chapter_soft_tokens, settings.chapter_hard_tokens),
            timeout_s=settings.chapter_timeout_s,
        ),
    )
    outline = build_outline_runner(
        engine=engine, secrets=app_secrets(settings), hub=hub, policy=policy
    )
    web_client = build_http_client(policy, proxy=settings.outbound_proxy)
    workbench = build_workbench_runner(
        engine=engine, secrets=app_secrets(settings), hub=hub, policy=policy, http=web_client
    )
    queue = PgJobQueue(engine, lock_timeout=settings.job_lock_timeout_s)
    listener = PgNotifyListener(engine, queue.channel)
    await listener.start()
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    registered = handlers(state, memory, outline, workbench)
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
    log.info("worker.started", worker_id=worker_id, kinds=list(registered))
    try:
        await worker.run(stop)
    finally:
        await listener.stop()
        await web_client.aclose()
        await hub.aclose()
        await engine.dispose()
        log.info("worker.stopped", worker_id=worker_id)
