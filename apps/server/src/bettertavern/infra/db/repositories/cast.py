"""多角色的局的角色（playthrough_cast，docs/cast.md）：开局时写入，玩家可以让某个角色先不出场。"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, execute, fetch_all, opt_str


@dataclass(frozen=True, slots=True)
class CastRow:
    position: int
    name: str
    cover_blob_id: str | None
    muted: bool

    @classmethod
    def from_row(cls, row: Row) -> CastRow:
        return cls(
            position=int(row["position"]),
            name=row["name"],
            cover_blob_id=opt_str(row["cover_blob_id"]),
            muted=bool(row["muted"]),
        )


async def list_cast(conn: AsyncConnection, playthrough_id: str) -> list[CastRow]:
    rows = await fetch_all(
        conn,
        """
        SELECT position, name, cover_blob_id, muted FROM playthrough_cast
        WHERE playthrough_id = :pt ORDER BY position
        """,
        {"pt": playthrough_id},
    )
    return [CastRow.from_row(r) for r in rows]


async def insert_cast(
    conn: AsyncConnection, playthrough_id: str, members: Sequence[tuple[str, str | None]]
) -> None:
    """members：按卡的顺序，每张卡的（名字，封面）。"""
    for position, (name, cover) in enumerate(members):
        await execute(
            conn,
            """
            INSERT INTO playthrough_cast (playthrough_id, position, name, cover_blob_id)
            VALUES (:pt, :pos, :name, :cover)
            """,
            {"pt": playthrough_id, "pos": position, "name": name, "cover": cover},
        )


async def set_muted(conn: AsyncConnection, playthrough_id: str, position: int, muted: bool) -> bool:
    count = await execute(
        conn,
        "UPDATE playthrough_cast SET muted = :m WHERE playthrough_id = :pt AND position = :pos",
        {"pt": playthrough_id, "pos": position, "m": muted},
    )
    return count == 1
