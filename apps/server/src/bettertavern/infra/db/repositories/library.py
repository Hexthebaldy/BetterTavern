"""剧本库：scenarios 与 blobs（角色卡头像等二进制；v1 存在库里，便于备份和单机部署）。"""

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
    opt_str,
)


@dataclass(frozen=True, slots=True)
class BlobRow:
    id: str
    mime: str
    size: int
    sha256: str
    data: bytes


async def insert_blob(
    conn: AsyncConnection, *, user_id: str, sha256: str, mime: str, data: bytes
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO blobs (user_id, sha256, mime, size, data)
        VALUES (:u, :sha, :mime, :size, :data)
        RETURNING id
        """,
        {"u": user_id, "sha": sha256, "mime": mime, "size": len(data), "data": data},
    )
    assert row is not None
    return str(row["id"])


async def get_blob(conn: AsyncConnection, user_id: str, blob_id: str) -> BlobRow | None:
    row = await fetch_one(
        conn,
        "SELECT id, mime, size, sha256, data FROM blobs WHERE id = :id AND user_id = :u",
        {"id": blob_id, "u": user_id},
    )
    if row is None:
        return None
    return BlobRow(
        id=str(row["id"]),
        mime=row["mime"],
        size=int(row["size"]),
        sha256=row["sha256"],
        data=bytes(row["data"]),
    )


async def delete_blob(conn: AsyncConnection, user_id: str, blob_id: str) -> None:
    await execute(
        conn, "DELETE FROM blobs WHERE id = :id AND user_id = :u", {"id": blob_id, "u": user_id}
    )


@dataclass(frozen=True, slots=True)
class ScenarioRow:
    id: str
    user_id: str
    name: str
    source_kind: str
    source_sha256: str | None
    card: dict[str, Any]
    avatar_blob_id: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> ScenarioRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            source_kind=row["source_kind"],
            source_sha256=row["source_sha256"],
            card=as_json(row["card"], {}),
            avatar_blob_id=opt_str(row["avatar_blob_id"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_SCENARIO_COLS = """id, user_id, name, source_kind, source_sha256, card, avatar_blob_id,
    created_at, updated_at"""


async def insert_scenario(
    conn: AsyncConnection,
    *,
    user_id: str,
    name: str,
    source_kind: str,
    source_sha256: str | None,
    raw: Any,
    card: dict[str, Any],
    avatar_blob_id: str | None,
) -> ScenarioRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO scenarios (user_id, name, source_kind, source_sha256, raw, card, avatar_blob_id)
        VALUES (:u, :name, :kind, :sha, CAST(:raw AS jsonb), CAST(:card AS jsonb), :avatar)
        RETURNING {_SCENARIO_COLS}
        """,
        {
            "u": user_id,
            "name": name,
            "kind": source_kind,
            "sha": source_sha256,
            "raw": dumps(raw),
            "card": dumps(card),
            "avatar": avatar_blob_id,
        },
    )
    assert row is not None
    return ScenarioRow.from_row(row)


async def find_scenario_by_sha(
    conn: AsyncConnection, user_id: str, sha256: str
) -> ScenarioRow | None:
    row = await fetch_one(
        conn,
        f"""SELECT {_SCENARIO_COLS} FROM scenarios
            WHERE user_id = :u AND source_sha256 = :sha ORDER BY created_at LIMIT 1""",
        {"u": user_id, "sha": sha256},
    )
    return None if row is None else ScenarioRow.from_row(row)


async def list_scenarios(conn: AsyncConnection, user_id: str) -> list[ScenarioRow]:
    rows = await fetch_all(
        conn,
        f"SELECT {_SCENARIO_COLS} FROM scenarios WHERE user_id = :u ORDER BY created_at DESC",
        {"u": user_id},
    )
    return [ScenarioRow.from_row(r) for r in rows]


async def get_scenario(conn: AsyncConnection, user_id: str, scenario_id: str) -> ScenarioRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_SCENARIO_COLS} FROM scenarios WHERE id = :id AND user_id = :u",
        {"id": scenario_id, "u": user_id},
    )
    return None if row is None else ScenarioRow.from_row(row)


async def rename_scenario(
    conn: AsyncConnection, user_id: str, scenario_id: str, name: str
) -> ScenarioRow | None:
    row = await fetch_one(
        conn,
        f"""UPDATE scenarios SET name = :name, updated_at = now()
            WHERE id = :id AND user_id = :u RETURNING {_SCENARIO_COLS}""",
        {"id": scenario_id, "u": user_id, "name": name},
    )
    return None if row is None else ScenarioRow.from_row(row)


async def delete_scenario(conn: AsyncConnection, user_id: str, scenario_id: str) -> str | None:
    """删除剧本，返回它的头像 blob id（由调用方在同一事务里删除）。不存在时返回空串以外的 None。"""
    row = await fetch_one(
        conn,
        "DELETE FROM scenarios WHERE id = :id AND user_id = :u RETURNING avatar_blob_id",
        {"id": scenario_id, "u": user_id},
    )
    if row is None:
        return None
    return opt_str(row["avatar_blob_id"]) or ""
