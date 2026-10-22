"""外部服务的配置：tool_routes（搜索、读网页、文生图）。

Key 只存密文（和 model_routes 一样的信封加密，行 id 绑进附加数据），解密在服务层、请求前进行。
同一种 kind 每个用户最多一个默认（tool_routes_default_uq）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, as_json, dumps, execute, fetch_all, fetch_one


@dataclass(frozen=True, slots=True)
class ToolRouteRow:
    id: str
    user_id: str
    kind: str
    provider: str
    label: str
    base_url: str | None
    api_key_enc: str | None
    key_id: str | None
    key_last4: str
    model: str | None
    params: dict[str, Any]
    status: str
    probe: dict[str, Any]
    is_default: bool
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> ToolRouteRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            kind=row["kind"],
            provider=row["provider"],
            label=row["label"],
            base_url=row["base_url"],
            api_key_enc=row["api_key_enc"],
            key_id=row["key_id"],
            key_last4=row["key_last4"],
            model=row["model"],
            params=as_json(row["params"], {}) or {},
            status=row["status"],
            probe=as_json(row["probe"], {}) or {},
            is_default=bool(row["is_default"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_COLS = """id, user_id, kind, provider, label, base_url, api_key_enc, key_id, key_last4, model,
    params, status, probe, is_default, created_at, updated_at"""


async def insert_route(conn: AsyncConnection, row: ToolRouteRow) -> ToolRouteRow:
    created = await fetch_one(
        conn,
        f"""INSERT INTO tool_routes (id, user_id, kind, provider, label, base_url, api_key_enc,
                                     key_id, key_last4, model, params)
            VALUES (:id, :u, :kind, :provider, :label, :base_url, :enc, :key_id, :last4, :model,
                    CAST(:params AS jsonb))
            RETURNING {_COLS}""",
        {
            "id": row.id,
            "u": row.user_id,
            "kind": row.kind,
            "provider": row.provider,
            "label": row.label,
            "base_url": row.base_url,
            "enc": row.api_key_enc,
            "key_id": row.key_id,
            "last4": row.key_last4,
            "model": row.model,
            "params": dumps(row.params),
        },
    )
    assert created is not None
    return ToolRouteRow.from_row(created)


async def update_route(conn: AsyncConnection, row: ToolRouteRow) -> ToolRouteRow | None:
    updated = await fetch_one(
        conn,
        f"""UPDATE tool_routes
            SET label = :label, base_url = :base_url, api_key_enc = :enc, key_id = :key_id,
                key_last4 = :last4, model = :model, params = CAST(:params AS jsonb),
                status = :status, probe = CAST(:probe AS jsonb), updated_at = now()
            WHERE id = :id AND user_id = :u
            RETURNING {_COLS}""",
        {
            "id": row.id,
            "u": row.user_id,
            "label": row.label,
            "base_url": row.base_url,
            "enc": row.api_key_enc,
            "key_id": row.key_id,
            "last4": row.key_last4,
            "model": row.model,
            "params": dumps(row.params),
            "status": row.status,
            "probe": dumps(row.probe),
        },
    )
    return None if updated is None else ToolRouteRow.from_row(updated)


async def list_routes(conn: AsyncConnection, user_id: str) -> list[ToolRouteRow]:
    rows = await fetch_all(
        conn,
        f"SELECT {_COLS} FROM tool_routes WHERE user_id = :u ORDER BY kind, created_at",
        {"u": user_id},
    )
    return [ToolRouteRow.from_row(r) for r in rows]


async def get_route(conn: AsyncConnection, user_id: str, route_id: str) -> ToolRouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM tool_routes WHERE id = :id AND user_id = :u",
        {"id": route_id, "u": user_id},
    )
    return None if row is None else ToolRouteRow.from_row(row)


async def get_default(conn: AsyncConnection, user_id: str, kind: str) -> ToolRouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM tool_routes WHERE user_id = :u AND kind = :k AND is_default",
        {"u": user_id, "k": kind},
    )
    return None if row is None else ToolRouteRow.from_row(row)


async def set_default(conn: AsyncConnection, user_id: str, kind: str, route_id: str | None) -> None:
    """先清掉这一种的默认，再设新的（唯一索引逐行检查，不能在一条语句里互换）。"""
    await execute(
        conn,
        """UPDATE tool_routes SET is_default = false, updated_at = now()
           WHERE user_id = :u AND kind = :k AND is_default""",
        {"u": user_id, "k": kind},
    )
    if route_id is not None:
        await execute(
            conn,
            """UPDATE tool_routes SET is_default = true, updated_at = now()
               WHERE id = :id AND user_id = :u AND kind = :k""",
            {"id": route_id, "u": user_id, "k": kind},
        )


async def set_status(
    conn: AsyncConnection, route_id: str, *, status: str, probe: dict[str, Any]
) -> None:
    await execute(
        conn,
        """UPDATE tool_routes SET status = :s, probe = CAST(:p AS jsonb), updated_at = now()
           WHERE id = :id""",
        {"id": route_id, "s": status, "p": dumps(probe)},
    )


async def delete_route(conn: AsyncConnection, user_id: str, route_id: str) -> ToolRouteRow | None:
    row = await fetch_one(
        conn,
        f"DELETE FROM tool_routes WHERE id = :id AND user_id = :u RETURNING {_COLS}",
        {"id": route_id, "u": user_id},
    )
    return None if row is None else ToolRouteRow.from_row(row)
