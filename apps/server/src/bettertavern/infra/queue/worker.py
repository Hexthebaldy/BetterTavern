"""worker 进程的主循环：领取任务、按 kind 分派、完成或失败重试、回收超时任务。

- 唤醒靠 LISTEN/NOTIFY，同时保留低频轮询兜底（通知可能在重连期间丢失）；
- 只领取自己有处理器的 kind，滚动发布时新旧版本的 worker 可以共存；
- 领取出错（例如数据库重启）不会让主循环退出，退避后继续；
- 收到停止信号后不再领取，等进行中的任务最多 shutdown_grace 秒，超时的任务被取消并归还队列
  （不消耗重试次数），不必等锁超时回收。
"""

from __future__ import annotations

import asyncio
import contextlib
import random
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence

import structlog

from .base import Job, JobQueue

log = structlog.get_logger(__name__)

Handler = Callable[[Job], Awaitable[None]]


class PermanentJobError(Exception):
    """处理器明确表示不该重试的失败（例如输入已经过期）。"""


def default_backoff(attempt: int) -> float:
    """后台任务退避：5 秒起翻倍，上限 120 秒，带抖动。"""
    base = min(5.0 * (2 ** max(attempt - 1, 0)), 120.0)
    return base * (0.5 + 0.5 * random.random())


class JobWorker:
    def __init__(
        self,
        queue: JobQueue,
        handlers: Mapping[str, Handler],
        *,
        worker_id: str,
        concurrency: int = 4,
        poll_interval: float = 5.0,
        reap_interval: float = 60.0,
        heartbeat_interval: float | None = None,
        shutdown_grace: float = 60.0,
        backoff: Callable[[int], float] = default_backoff,
        wakeup: asyncio.Event | None = None,
        kinds: Sequence[str] | None = None,
    ) -> None:
        self._queue = queue
        self._handlers = dict(handlers)
        self._worker_id = worker_id
        self._concurrency = concurrency
        self._poll_interval = poll_interval
        self._reap_interval = reap_interval
        # 心跳间隔取锁超时的三分之一，保证活着的任务不会被当成超时回收
        self._heartbeat_interval = heartbeat_interval or max(queue.lock_timeout / 3, 0.01)
        self._shutdown_grace = shutdown_grace
        self._backoff = backoff
        self._wakeup = wakeup or asyncio.Event()
        self._kinds: tuple[str, ...] = tuple(kinds if kinds is not None else self._handlers)
        self._tasks: dict[asyncio.Task[None], Job] = {}

    @property
    def in_flight(self) -> int:
        return len(self._tasks)

    async def run(self, stop: asyncio.Event) -> None:
        reaper = asyncio.create_task(self._reap_loop(stop))
        claim_errors = 0
        try:
            while not stop.is_set():
                # 先清事件再领取：领取期间到达的通知不会丢
                self._wakeup.clear()
                try:
                    claimed = await self._fill()
                    claim_errors = 0
                except Exception:
                    claim_errors += 1
                    log.exception("job.claim_failed", consecutive=claim_errors)
                    await self._sleep_or_stop(stop, min(self._poll_interval * claim_errors, 60.0))
                    continue
                if claimed:
                    continue
                await self._wait(stop)
        finally:
            reaper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reaper
            await self._drain()

    async def run_once(self) -> int:
        """领取并执行当前所有可执行的任务（测试和脚本用）。返回执行的任务数。"""
        count = 0
        while True:
            job = await self._queue.claim(self._worker_id, kinds=self._kinds)
            if job is None:
                return count
            await self._execute(job)
            count += 1

    async def _fill(self) -> bool:
        claimed = False
        while len(self._tasks) < self._concurrency:
            job = await self._queue.claim(self._worker_id, kinds=self._kinds)
            if job is None:
                break
            claimed = True
            task = asyncio.create_task(self._execute(job), name=f"job-{job.id}")
            self._tasks[task] = job
            task.add_done_callback(self._on_task_done)
        return claimed

    def _on_task_done(self, task: asyncio.Task[None]) -> None:
        self._tasks.pop(task, None)
        self._wakeup.set()  # 有空位了，回到主循环继续领取

    async def _wait(self, stop: asyncio.Event) -> None:
        waiters = [
            asyncio.create_task(self._wakeup.wait()),
            asyncio.create_task(stop.wait()),
        ]
        try:
            await asyncio.wait(
                waiters, timeout=self._poll_interval, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for waiter in waiters:
                waiter.cancel()

    async def _sleep_or_stop(self, stop: asyncio.Event, seconds: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=seconds)

    async def _drain(self) -> None:
        """停止时等进行中的任务；超过宽限期的取消，由 _execute 归还队列。"""
        tasks = list(self._tasks)
        if not tasks:
            return
        log.info("worker.draining", in_flight=len(tasks), grace_s=self._shutdown_grace)
        _, pending = await asyncio.wait(tasks, timeout=self._shutdown_grace)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.wait(pending)

    async def _execute(self, job: Job) -> None:
        # 这个任务里打的日志都带上任务编号（任务在自己的 asyncio task 里跑，绑定不会串到别的任务）
        with structlog.contextvars.bound_contextvars(
            job_id=job.id, job_kind=job.kind, ordering_key=job.ordering_key
        ):
            await self._execute_bound(job)

    async def _execute_bound(self, job: Job) -> None:
        handler = self._handlers.get(job.kind)
        if handler is None:
            # 只领取有处理器的 kind，正常不会走到这里；万一走到，还回去让别的 worker 处理
            await self._queue.release(job, self._worker_id, f"没有处理器：{job.kind}")
            return
        heartbeat = asyncio.create_task(self._heartbeat(job))
        started = time.perf_counter()
        log.info("job.started", attempt=job.attempts, max_attempts=job.max_attempts)

        def elapsed() -> int:
            return round((time.perf_counter() - started) * 1000)

        try:
            await handler(job)
        except asyncio.CancelledError:
            # 停机时被取消：还回队列，不消耗重试次数
            log.info("job.released", reason="shutdown", duration_ms=elapsed())
            with contextlib.suppress(Exception):
                await asyncio.shield(self._queue.release(job, self._worker_id, "worker 停止"))
            raise
        except PermanentJobError as exc:
            log.warning(
                "job.failed",
                duration_ms=elapsed(),
                error_class=type(exc).__name__,
                will_retry=False,
            )
            await self._queue.fail(
                job, self._worker_id, f"{type(exc).__name__}: {exc}", retry_delay=None
            )
        except Exception as exc:
            delay = None if job.exhausted else self._backoff(job.attempts)
            log.exception(
                "job.failed",
                duration_ms=elapsed(),
                error_class=type(exc).__name__,
                will_retry=delay is not None,
                retry_in_s=delay,
            )
            await self._queue.fail(
                job, self._worker_id, f"{type(exc).__name__}: {exc}", retry_delay=delay
            )
        else:
            if await self._queue.complete(job, self._worker_id):
                log.info("job.done", duration_ms=elapsed())
            else:
                # 完成时已不归本 worker（锁超时被回收）
                log.warning("job.lock_lost", duration_ms=elapsed())
        finally:
            heartbeat.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await heartbeat

    async def _heartbeat(self, job: Job) -> None:
        while True:
            await asyncio.sleep(self._heartbeat_interval)
            try:
                if not await self._queue.touch(job, self._worker_id):
                    return
            except Exception:
                log.exception("job.renew_failed")

    async def _reap_loop(self, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                reaped = await self._queue.reap()
                if reaped:
                    log.warning("job.reaped", count=len(reaped), job_ids=list(reaped))
                    self._wakeup.set()
            except Exception:
                log.exception("job.reap_failed")
            await self._sleep_or_stop(stop, self._reap_interval)
