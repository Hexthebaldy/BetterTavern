"""Postgres 队列的集成测试：需要真实数据库，设置 BT_TEST_DATABASE_URL 后运行。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest -m integration
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from pathlib import Path
from types import ModuleType

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

SERVER_ROOT = Path(__file__).resolve().parents[2]

DATABASE_URL = os.environ.get("BT_TEST_DATABASE_URL")
if not DATABASE_URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine  # noqa: E402

from bettertavern.infra.db.engine import normalize_url  # noqa: E402
from bettertavern.infra.queue.base import Job  # noqa: E402
from bettertavern.infra.queue.notify import PgNotifyListener  # noqa: E402
from bettertavern.infra.queue.pg_queue import PgJobQueue  # noqa: E402
from bettertavern.infra.queue.worker import JobWorker  # noqa: E402


def load_migration(name: str) -> ModuleType:
    """按文件路径加载迁移模块，测试用它的冻结 DDL 建表，和生产迁移保持一致。"""
    path = SERVER_ROOT / "migrations" / "versions" / name
    spec = importlib.util.spec_from_file_location(f"migration_{path.stem}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


JOBS_MIGRATION = load_migration("20261013_0001_jobs.py")


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    assert DATABASE_URL is not None
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(normalize_url(DATABASE_URL))
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = create_async_engine(
        normalize_url(DATABASE_URL),
        connect_args={"server_settings": {"search_path": schema}},
    )
    async with scoped.begin() as conn:
        for statement in JOBS_MIGRATION.statements(JOBS_MIGRATION.DDL):
            await conn.execute(text(statement))
    try:
        yield scoped
    finally:
        await scoped.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


async def test_enqueue_is_part_of_the_callers_transaction(engine: AsyncEngine) -> None:
    queue = PgJobQueue(engine)
    async with engine.connect() as conn:
        transaction = await conn.begin()
        await queue.enqueue(conn, "post_turn", "pt1:state", {"turn": 1})
        await transaction.rollback()
    assert await queue.claim("w1") is None
    async with engine.begin() as conn:
        job_id = await queue.enqueue(conn, "post_turn", "pt1:state", {"turn": 1, "名字": "林"})
    job = await queue.claim("w1")
    assert job is not None and job.id == job_id
    assert job.payload == {"turn": 1, "名字": "林"}
    assert await queue.complete(job, "w1")


async def test_fencing_retry_and_reap(engine: AsyncEngine) -> None:
    queue = PgJobQueue(engine, lock_timeout=60)
    async with engine.begin() as conn:
        first = await queue.enqueue(conn, "x", "k")
        await queue.enqueue(conn, "x", "k")
    job = await queue.claim("w1")
    assert job is not None and job.id == first
    assert await queue.claim("w2") is None  # 同键第二个任务被挡住
    assert await queue.complete(job, "w2") is False  # 非持有者
    assert await queue.fail(job, "w1", "boom", retry_delay=0.0) == "pending"
    again = await queue.claim("w2")
    assert again is not None and again.id == first and again.attempts == 2
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE jobs SET locked_at = now() - interval '5 minutes' WHERE id = :id"),
            {"id": first},
        )
    assert await queue.reap() == [first]
    assert await queue.complete(again, "w2") is False  # 被回收后迟到的完成无效


async def test_notify_wakes_listener(engine: AsyncEngine) -> None:
    queue = PgJobQueue(engine, channel=f"bt_jobs_{uuid.uuid4().hex[:8]}")
    listener = PgNotifyListener(engine, queue.channel)
    await listener.start()
    try:
        async with engine.begin() as conn:
            await queue.enqueue(conn, "x", "k")
        await asyncio.wait_for(listener.event.wait(), timeout=5)
    finally:
        await listener.stop()


async def test_concurrent_workers_keep_lanes_serial(engine: AsyncEngine) -> None:
    queue = PgJobQueue(engine)
    keys = [f"pt{i}:state" for i in range(6)]
    async with engine.begin() as conn:
        for n in range(8):
            for key in keys:
                await queue.enqueue(conn, "work", key, {"n": n})
    running: set[str] = set()
    overlaps: list[str] = []  # 不能在处理器里 assert：异常会被 worker 当成任务失败去重试
    order: dict[str, list[int]] = defaultdict(list)
    total = len(keys) * 8
    stop = asyncio.Event()

    async def handler(job: Job) -> None:
        if job.ordering_key in running:
            overlaps.append(job.ordering_key)
        running.add(job.ordering_key)
        await asyncio.sleep(0.005)
        order[job.ordering_key].append(int(job.payload["n"]))
        running.discard(job.ordering_key)
        if sum(len(v) for v in order.values()) == total:
            stop.set()

    workers = [
        JobWorker(queue, {"work": handler}, worker_id=f"w{i}", concurrency=3, poll_interval=0.05)
        for i in range(3)
    ]
    await asyncio.wait_for(asyncio.gather(*(w.run(stop) for w in workers)), timeout=30)
    assert overlaps == []
    assert all(order[key] == list(range(8)) for key in keys)


async def test_concurrent_enqueues_to_one_lane_keep_commit_order(engine: AsyncEngine) -> None:
    """两个事务并发给同一车道入队：先开始的事务先拿到锁，后一个要等它提交才能分配 id。"""
    queue = PgJobQueue(engine)
    first_inserted = asyncio.Event()
    release_first = asyncio.Event()

    async def slow_transaction() -> None:
        async with engine.begin() as conn:
            await queue.enqueue(conn, "x", "lane", {"who": "first"})
            first_inserted.set()
            await release_first.wait()

    async def fast_transaction() -> None:
        await first_inserted.wait()
        async with engine.begin() as conn:
            await queue.enqueue(conn, "x", "lane", {"who": "second"})

    slow = asyncio.create_task(slow_transaction())
    fast = asyncio.create_task(fast_transaction())
    await asyncio.sleep(0.3)
    assert await queue.claim("w1") is None  # 第一个还没提交，第二个在等锁
    release_first.set()
    await asyncio.gather(slow, fast)
    job = await queue.claim("w1")
    assert job is not None and job.payload == {"who": "first"}
    assert await queue.claim("w2") is None  # 第二个要等第一个完成
