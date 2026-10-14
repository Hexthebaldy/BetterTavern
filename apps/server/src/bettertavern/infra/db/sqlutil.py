"""执行 SQL 的小工具：参数与结果的统一转换。"""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

Row = Mapping[str, Any]


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def as_json(value: Any, default: Any = None) -> Any:
    """读出的 JSONB：asyncpg 方言会解码成对象，其他驱动可能给字符串。"""
    if value is None:
        return default
    if isinstance(value, str | bytes):
        return json.loads(value)
    return value


def as_str(value: Any) -> str:
    return str(value)


def opt_str(value: Any) -> str | None:
    return None if value is None else str(value)


def as_uuid_list(values: Sequence[str]) -> list[str]:
    """校验后原样返回（asyncpg 接受字符串形式的 uuid 数组）。"""
    return [str(uuid.UUID(v)) for v in values]


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def opt_dt(value: Any) -> datetime | None:
    return value if isinstance(value, datetime) else None


async def fetch_one(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> Row | None:
    result = await conn.execute(text(sql), dict(params))
    row = result.mappings().first()
    return None if row is None else dict(row)


async def fetch_all(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> list[Row]:
    result = await conn.execute(text(sql), dict(params))
    return [dict(r) for r in result.mappings().all()]


async def fetch_value(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> Any:
    result = await conn.execute(text(sql), dict(params))
    return result.scalar_one_or_none()


async def execute(conn: AsyncConnection, sql: str, params: Mapping[str, Any]) -> int:
    result = await conn.execute(text(sql), dict(params))
    return int(result.rowcount)
