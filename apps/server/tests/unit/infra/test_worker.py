from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Sequence

import pytest

from bettertavern.infra.queue.base import Job
from bettertavern.infra.queue.worker import JobWorker, PermanentJobError
from tests.fakes.memory_queue import InMemoryJobQueue

pytestmark = pytest.mark.anyio


async def test_lanes_run_serially_per_key_and_in_parallel_across_keys() -> None:
    queue = InMemoryJobQueue()
    for n in range(5):
        for key in ("pt1:state", "pt1:summary", "pt2:state"):
            queue.enqueue("work", key, {"n": n})
    running: dict[str, int] = {}
    order: dict[str, list[int]] = defaultdict(list)
    peak = 0
    stop = asyncio.Event()

    async def handler(job: Job) -> None:
        nonlocal peak
        assert job.ordering_key not in running, "同一车道出现了并发"
        running[job.ordering_key] = job.id
        peak = max(peak, len(running))
        await asyncio.sleep(0.01)
        order[job.ordering_key].append(job.payload["n"])
        del running[job.ordering_key]
        if sum(len(v) for v in order.values()) == len(queue.rows):
            stop.set()

    worker = JobWorker(queue, {"work": handler}, worker_id="w1", concurrency=4, poll_interval=0.01)
    await asyncio.wait_for(worker.run(stop), timeout=5)
    assert all(row.status == "done" for row in queue.rows.values())
    assert all(order[key] == [0, 1, 2, 3, 4] for key in order)
    assert peak >= 2  # 不同车道确实并行了


async def test_failure_is_retried_with_backoff_then_succeeds() -> None:
    queue = InMemoryJobQueue()
    job_id = queue.enqueue("flaky", "k")
    attempts = 0

    async def flaky(job: Job) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("临时错误")

    worker = JobWorker(queue, {"flaky": flaky}, worker_id="w1", backoff=lambda attempt: 0.0)
    assert await worker.run_once() == 2
    assert queue.status(job_id) == "done"
    assert queue.rows[job_id].history == ["RuntimeError: 临时错误"]


async def test_exhausted_attempts_mark_failed_and_unblock_lane() -> None:
    queue = InMemoryJobQueue()
    first = queue.enqueue("bad", "k", max_attempts=2)
    second = queue.enqueue("ok", "k")
    done: list[int] = []

    async def bad(job: Job) -> None:
        raise RuntimeError("总是失败")

    async def ok(job: Job) -> None:
        done.append(job.id)

    worker = JobWorker(queue, {"bad": bad, "ok": ok}, worker_id="w1", backoff=lambda attempt: 0.0)
    await worker.run_once()
    assert queue.status(first) == "failed"
    assert done == [second]


async def test_permanent_error_is_not_retried() -> None:
    queue = InMemoryJobQueue()
    job_id = queue.enqueue("stale", "k")

    async def stale(job: Job) -> None:
        raise PermanentJobError("版本已过期")

    worker = JobWorker(queue, {"stale": stale}, worker_id="w1", backoff=lambda attempt: 0.0)
    assert await worker.run_once() == 1
    assert queue.status(job_id) == "failed"


async def test_unknown_kinds_are_left_for_other_workers() -> None:
    queue = InMemoryJobQueue()
    foreign = queue.enqueue("from_newer_version", "k1")
    mine = queue.enqueue("noop", "k2")
    done: list[int] = []

    async def noop(job: Job) -> None:
        done.append(job.id)

    worker = JobWorker(queue, {"noop": noop}, worker_id="w1")
    assert await worker.run_once() == 1
    assert done == [mine]
    assert queue.status(foreign) == "pending"  # 滚动发布时留给能处理它的 worker


async def test_worker_without_handlers_claims_nothing() -> None:
    queue = InMemoryJobQueue()
    queue.enqueue("noop", "k")
    assert await JobWorker(queue, {}, worker_id="w1").run_once() == 0


async def test_claim_errors_do_not_kill_the_loop() -> None:
    queue = InMemoryJobQueue()
    job_id = queue.enqueue("noop", "k")
    real_claim = queue.claim
    failures = [RuntimeError("database restarting")] * 2
    stop = asyncio.Event()

    async def flaky_claim(worker_id: str, *, kinds: Sequence[str] | None = None) -> Job | None:
        if failures:
            raise failures.pop()
        return await real_claim(worker_id, kinds=kinds)

    queue.claim = flaky_claim  # type: ignore[method-assign]

    async def noop(job: Job) -> None:
        stop.set()

    worker = JobWorker(queue, {"noop": noop}, worker_id="w1", poll_interval=0.01)
    await asyncio.wait_for(worker.run(stop), timeout=5)
    assert queue.status(job_id) == "done"


async def test_shutdown_waits_then_releases_unfinished_jobs() -> None:
    queue = InMemoryJobQueue()
    quick = queue.enqueue("quick", "k1")
    slow = queue.enqueue("slow", "k2")
    stop = asyncio.Event()
    started = asyncio.Event()

    async def quick_job(job: Job) -> None:
        await asyncio.sleep(0.01)

    async def slow_job(job: Job) -> None:
        started.set()
        await asyncio.sleep(10)

    worker = JobWorker(
        queue,
        {"quick": quick_job, "slow": slow_job},
        worker_id="w1",
        poll_interval=0.01,
        shutdown_grace=0.1,
    )
    run = asyncio.create_task(worker.run(stop))
    await asyncio.wait_for(started.wait(), timeout=5)
    stop.set()
    await asyncio.wait_for(run, timeout=5)
    assert queue.status(quick) == "done"
    assert queue.status(slow) == "pending"  # 被取消后还回队列
    assert queue.rows[slow].attempts == 0  # 不消耗重试次数
    again = await queue.claim("w2")
    assert again is not None and again.id == slow


def test_heartbeat_defaults_to_a_third_of_lock_timeout() -> None:
    worker = JobWorker(InMemoryJobQueue(lock_timeout=30), {}, worker_id="w1")
    assert worker._heartbeat_interval == 10


async def test_heartbeat_keeps_long_job_from_being_reaped() -> None:
    now = [0.0]
    queue = InMemoryJobQueue(lock_timeout=10, clock=lambda: now[0])
    job_id = queue.enqueue("long", "k")
    release = asyncio.Event()

    async def long_job(job: Job) -> None:
        await release.wait()

    worker = JobWorker(queue, {"long": long_job}, worker_id="w1", heartbeat_interval=0.01)
    job = await queue.claim("w1")
    assert job is not None
    task = asyncio.create_task(worker._execute(job))
    now[0] = 9.0
    await asyncio.sleep(0.05)  # 心跳把 locked_at 续到 9
    now[0] = 15.0
    assert await queue.reap() == []  # 15 − 9 < 10，没有超时
    release.set()
    await task
    assert queue.status(job_id) == "done"


async def test_late_completion_after_reap_is_ignored() -> None:
    now = [0.0]
    queue = InMemoryJobQueue(lock_timeout=10, clock=lambda: now[0])
    job_id = queue.enqueue("x", "k")
    job = await queue.claim("dead-worker")
    assert job is not None
    now[0] = 100.0
    assert await queue.reap() == [job_id]
    assert await queue.complete(job, "dead-worker") is False
    again = await queue.claim("w2")
    assert again is not None and again.attempts == 2
