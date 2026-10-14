"""数据库引擎。PostgreSQL 是唯一事实来源；驱动用 asyncpg。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def normalize_url(url: str) -> str:
    """把 postgres:// 或 postgresql:// 统一成 SQLAlchemy 的 asyncpg 写法。"""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix) :]
    return url


def create_engine(url: str, *, pool_size: int = 10, echo: bool = False) -> AsyncEngine:
    return create_async_engine(
        normalize_url(url),
        pool_size=pool_size,
        max_overflow=pool_size,
        pool_pre_ping=True,
        echo=echo,
        # 出错时异常信息里不带 SQL 参数：参数里有玩家输入和叙述，日志不能写故事文本
        hide_parameters=True,
    )
