"""model_routes：一行是一个配好的模型（Key、端点、模型名、窗口、写法设置）。

密钥列只存密文，解密在服务层、请求前进行。
每个用户最多一行 is_director、一行 is_background、一行 is_workbench
（部分唯一索引保证）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import (
    Row,
    as_json,
    dumps,
    execute,
    fetch_all,
    fetch_one,
)


@dataclass(frozen=True, slots=True)
class RouteRow:
    id: str
    user_id: str
    label: str
    provider: str
    base_url: str | None
    api_key_enc: str
    key_id: str
    key_last4: str
    extra_headers_enc: str | None
    extra_body: dict[str, Any]
    model: str
    listed_window: int | None
    manual_window: int | None
    learned_window: int | None
    params: dict[str, Any]
    caps_override: dict[str, Any]
    probe: dict[str, Any]
    status: str
    last_ok_at: datetime | None
    is_director: bool
    is_background: bool
    created_at: datetime
    updated_at: datetime
    is_workbench: bool = False  # 工作台用的模型（每个用户最多一行）

    @classmethod
    def from_row(cls, row: Row) -> RouteRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            label=row["label"],
            provider=row["provider"],
            base_url=row["base_url"],
            api_key_enc=row["api_key_enc"],
            key_id=row["key_id"],
            key_last4=row["key_last4"],
            extra_headers_enc=row["extra_headers_enc"],
            extra_body=as_json(row["extra_body"], {}),
            model=row["model"],
            listed_window=row["listed_window"],
            manual_window=row["manual_window"],
            learned_window=row["learned_window"],
            params=as_json(row["params"], {}),
            caps_override=as_json(row["caps_override"], {}),
            probe=as_json(row["probe"], {}),
            status=row["status"],
            last_ok_at=row["last_ok_at"],
            is_director=row["is_director"],
            is_background=row["is_background"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            is_workbench=bool(row.get("is_workbench", False)),
        )


_COLS = """id, user_id, label, provider, base_url, api_key_enc, key_id, key_last4,
    extra_headers_enc, extra_body, model, listed_window, manual_window, learned_window, params,
    caps_override, probe, status, last_ok_at, is_director, is_background, created_at, updated_at,
    is_workbench"""


def _params(route: RouteRow) -> dict[str, Any]:
    return {
        "id": route.id,
        "user_id": route.user_id,
        "label": route.label,
        "provider": route.provider,
        "base_url": route.base_url,
        "api_key_enc": route.api_key_enc,
        "key_id": route.key_id,
        "key_last4": route.key_last4,
        "extra_headers_enc": route.extra_headers_enc,
        "extra_body": dumps(route.extra_body),
        "model": route.model,
        "listed_window": route.listed_window,
        "manual_window": route.manual_window,
        "learned_window": route.learned_window,
        "params": dumps(route.params),
        "caps_override": dumps(route.caps_override),
        "probe": dumps(route.probe),
        "status": route.status,
        "last_ok_at": route.last_ok_at,
    }


async def insert_route(conn: AsyncConnection, route: RouteRow) -> RouteRow:
    """插入一行；is_director、is_background 不在这里写，用 set_director()、set_background()。"""
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO model_routes (id, user_id, label, provider, base_url, api_key_enc, key_id,
            key_last4, extra_headers_enc, extra_body, model, listed_window, manual_window,
            learned_window, params, caps_override, probe, status, last_ok_at)
        VALUES (:id, :user_id, :label, :provider, :base_url, :api_key_enc, :key_id, :key_last4,
            :extra_headers_enc, CAST(:extra_body AS jsonb), :model, :listed_window,
            :manual_window, :learned_window, CAST(:params AS jsonb),
            CAST(:caps_override AS jsonb), CAST(:probe AS jsonb), :status, :last_ok_at)
        RETURNING {_COLS}
        """,
        _params(route),
    )
    assert row is not None
    return RouteRow.from_row(row)


async def update_route(conn: AsyncConnection, route: RouteRow) -> RouteRow:
    """按 route 的内容整行改写（除了归属、导演标记和时间）。"""
    row = await fetch_one(
        conn,
        f"""
        UPDATE model_routes
        SET label = :label, base_url = :base_url, api_key_enc = :api_key_enc, key_id = :key_id,
            key_last4 = :key_last4, extra_headers_enc = :extra_headers_enc,
            extra_body = CAST(:extra_body AS jsonb), model = :model,
            listed_window = :listed_window, manual_window = :manual_window,
            learned_window = :learned_window, params = CAST(:params AS jsonb),
            caps_override = CAST(:caps_override AS jsonb), probe = CAST(:probe AS jsonb),
            status = :status, last_ok_at = :last_ok_at, updated_at = now()
        WHERE id = :id AND user_id = :user_id
        RETURNING {_COLS}
        """,
        {k: v for k, v in _params(route).items() if k != "provider"},
    )
    assert row is not None
    return RouteRow.from_row(row)


async def list_routes(conn: AsyncConnection, user_id: str) -> list[RouteRow]:
    rows = await fetch_all(
        conn,
        f"SELECT {_COLS} FROM model_routes WHERE user_id = :u ORDER BY created_at, id",
        {"u": user_id},
    )
    return [RouteRow.from_row(r) for r in rows]


async def get_route(
    conn: AsyncConnection, user_id: str, route_id: str, *, lock: bool = False
) -> RouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM model_routes WHERE id = :id AND user_id = :u"
        + (" FOR UPDATE" if lock else ""),
        {"id": route_id, "u": user_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def get_director(conn: AsyncConnection, user_id: str) -> RouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM model_routes WHERE user_id = :u AND is_director",
        {"u": user_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def set_director(conn: AsyncConnection, user_id: str, route_id: str | None) -> None:
    """把 route_id 设为导演（None 表示取消导演）。先清掉旧的，部分唯一索引是逐行检查的。"""
    await execute(
        conn,
        "UPDATE model_routes SET is_director = false, updated_at = now() "
        "WHERE user_id = :u AND is_director",
        {"u": user_id},
    )
    if route_id is not None:
        await execute(
            conn,
            "UPDATE model_routes SET is_director = true, updated_at = now() "
            "WHERE id = :id AND user_id = :u",
            {"id": route_id, "u": user_id},
        )


async def get_background(conn: AsyncConnection, user_id: str) -> RouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM model_routes WHERE user_id = :u AND is_background",
        {"u": user_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def set_background(conn: AsyncConnection, user_id: str, route_id: str | None) -> None:
    """把 route_id 设为后台整理用的模型（None 表示取消）。和 set_director 一样先清掉旧的。"""
    await execute(
        conn,
        "UPDATE model_routes SET is_background = false, updated_at = now() "
        "WHERE user_id = :u AND is_background",
        {"u": user_id},
    )
    if route_id is not None:
        await execute(
            conn,
            "UPDATE model_routes SET is_background = true, updated_at = now() "
            "WHERE id = :id AND user_id = :u",
            {"id": route_id, "u": user_id},
        )


async def get_workbench(conn: AsyncConnection, user_id: str) -> RouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM model_routes WHERE user_id = :u AND is_workbench",
        {"u": user_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def set_workbench(conn: AsyncConnection, user_id: str, route_id: str | None) -> None:
    """把 route_id 设为工作台用的模型（None 表示取消，工作台改用导演）。"""
    await execute(
        conn,
        "UPDATE model_routes SET is_workbench = false, updated_at = now() "
        "WHERE user_id = :u AND is_workbench",
        {"u": user_id},
    )
    if route_id is not None:
        await execute(
            conn,
            "UPDATE model_routes SET is_workbench = true, updated_at = now() "
            "WHERE id = :id AND user_id = :u",
            {"id": route_id, "u": user_id},
        )


async def set_status(
    conn: AsyncConnection,
    route_id: str,
    *,
    status: str | None,
    ok: bool,
    probe: dict[str, Any] | None = None,
    listed_window: int | None = None,
) -> None:
    """记录一次探测或获取模型列表的结果；传 None 的列不改。"""
    await execute(
        conn,
        """
        UPDATE model_routes
        SET status = COALESCE(:status, status),
            last_ok_at = CASE WHEN :ok THEN now() ELSE last_ok_at END,
            probe = COALESCE(CAST(:probe AS jsonb), probe),
            listed_window = COALESCE(:listed_window, listed_window),
            updated_at = now()
        WHERE id = :id
        """,
        {
            "id": route_id,
            "status": status,
            "ok": ok,
            "probe": None if probe is None else dumps(probe),
            "listed_window": listed_window,
        },
    )


async def lower_learned_window(
    conn: AsyncConnection, user_id: str, route_id: str, window: int
) -> bool:
    """记下运行中学到的窗口；只会往小改。返回是否改了。"""
    count = await execute(
        conn,
        """
        UPDATE model_routes SET learned_window = :w, updated_at = now()
        WHERE id = :id AND user_id = :u AND (learned_window IS NULL OR learned_window > :w)
        """,
        {"id": route_id, "u": user_id, "w": window},
    )
    return count == 1


async def delete_route(conn: AsyncConnection, user_id: str, route_id: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM model_routes WHERE id = :id AND user_id = :u",
        {"id": route_id, "u": user_id},
    )
    return count == 1
