"""集成测试用的数据库工具：每个测试一个临时 schema，用迁移里冻结的 DDL 建表。

需要真实 Postgres：设置 BT_TEST_DATABASE_URL（例如 make db-up 起的那个）。

asyncpg 的连接绑定在创建它的事件循环上：被测服务跑在另一个线程的事件循环里时，给它单独建引擎
（engine_for），不要和测试线程共用。
"""

from __future__ import annotations

import importlib.util
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import ModuleType

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from bettertavern.infra.db.engine import normalize_url

SERVER_ROOT = Path(__file__).resolve().parents[2]
VERSIONS = SERVER_ROOT / "migrations" / "versions"


def database_url() -> str | None:
    return os.environ.get("BT_TEST_DATABASE_URL")


def load_migration(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"migration_{path.stem}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migrations() -> list[ModuleType]:
    """按文件名排序的全部迁移（文件名以日期和序号开头）。"""
    return [load_migration(p) for p in sorted(VERSIONS.glob("*.py"))]


def engine_for(url: str, schema: str, *, pool_size: int = 5) -> AsyncEngine:
    return create_async_engine(
        normalize_url(url),
        pool_size=pool_size,
        connect_args={"server_settings": {"search_path": schema}},
    )


@asynccontextmanager
async def temp_schema(url: str) -> AsyncIterator[str]:
    """建一个临时 schema 并执行全部迁移，产出 schema 名；结束时删掉。"""
    schema = f"test_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(normalize_url(url))
    async with admin.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    setup = engine_for(url, schema, pool_size=1)
    try:
        async with setup.begin() as conn:
            for module in migrations():
                for statement in module.statements(module.DDL):
                    await conn.execute(text(statement))
        await setup.dispose()
        yield schema
    finally:
        await setup.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin.dispose()


@asynccontextmanager
async def schema_engine(url: str, *, pool_size: int = 5) -> AsyncIterator[AsyncEngine]:
    """临时 schema 加一个绑定到它的引擎（在当前事件循环里使用）。"""
    async with temp_schema(url) as schema:
        engine = engine_for(url, schema, pool_size=pool_size)
        try:
            yield engine
        finally:
            await engine.dispose()
