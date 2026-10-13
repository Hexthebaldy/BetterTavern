"""Alembic 环境：异步引擎。迁移只往前，发布前建议先备份。

连接串的来源依次是：环境变量 DATABASE_URL、alembic.ini 的 sqlalchemy.url、
服务端配置 Settings（会读取工作目录下的 .env）。
"""

from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from bettertavern.infra.db.engine import normalize_url

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# v1 的迁移是手写的 SQL，不依赖 ORM 元数据自动生成
target_metadata = None


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
    if not url:
        from bettertavern.settings import Settings

        url = Settings().database_url
    return normalize_url(url)


def run_migrations_offline() -> None:
    context.configure(url=database_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(database_url(), poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
