"""剧本仓库：scenarios、scenario_cards、scenario_lorebooks，以及 blobs（封面等图片；存在库里，
便于备份和单机部署）。

角色卡本身在 cards.py，世界书在 lorebooks.py。剧本只记用了哪几张卡（scenario_cards）、挂了哪几本
世界书（scenario_lorebooks），开新故事时读它们当时的正式内容。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import (
    Row,
    as_json,
    as_uuid_list,
    dumps,
    execute,
    fetch_all,
    fetch_one,
    opt_str,
)

# ---- blobs ----


@dataclass(frozen=True, slots=True)
class BlobRow:
    id: str
    mime: str
    size: int
    sha256: str
    data: bytes
    width: int | None = None
    height: int | None = None


async def insert_blob(
    conn: AsyncConnection,
    *,
    user_id: str,
    sha256: str,
    mime: str,
    data: bytes,
    width: int | None = None,
    height: int | None = None,
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO blobs (user_id, sha256, mime, size, data, width, height)
        VALUES (:u, :sha, :mime, :size, :data, :w, :h)
        RETURNING id
        """,
        {
            "u": user_id,
            "sha": sha256,
            "mime": mime,
            "size": len(data),
            "data": data,
            "w": width,
            "h": height,
        },
    )
    assert row is not None
    return str(row["id"])


async def user_blob_bytes(conn: AsyncConnection, user_id: str) -> int:
    """这个用户存的图一共多少字节（封面、导入的卡图、工作台的图）。"""
    row = await fetch_one(
        conn, "SELECT COALESCE(SUM(size), 0) AS total FROM blobs WHERE user_id = :u", {"u": user_id}
    )
    return int(row["total"]) if row is not None else 0


async def get_blob(conn: AsyncConnection, user_id: str, blob_id: str) -> BlobRow | None:
    row = await fetch_one(
        conn,
        """SELECT id, mime, size, sha256, data, width, height FROM blobs
           WHERE id = :id AND user_id = :u""",
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
        width=row["width"],
        height=row["height"],
    )


async def delete_orphan_blobs(conn: AsyncConnection, user_id: str, blob_ids: Sequence[str]) -> int:
    """删掉这几张图里已经没人用的：不是哪张卡或哪个版本的封面、哪个人设的头像、
    哪一局的角色头像，也不在哪份草稿的图片里、不是哪一回合的配图。"""
    ids = sorted({b for b in blob_ids if b})
    if not ids:
        return 0
    return await execute(
        conn,
        """
        DELETE FROM blobs AS b
        WHERE b.user_id = :u AND b.id = ANY(CAST(:ids AS uuid[]))
          AND NOT EXISTS (SELECT 1 FROM cards WHERE cover_blob_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM card_revisions WHERE cover_blob_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM workbench_assets WHERE blob_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM personas WHERE avatar_blob_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM playthrough_cast WHERE cover_blob_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM turn_images WHERE blob_id = b.id)
        """,
        {"u": user_id, "ids": as_uuid_list(ids)},
    )


# ---- scenarios ----


@dataclass(frozen=True, slots=True)
class ScenarioCardRef:
    """剧本里的一张卡（列表和详情用，不带卡片全文）。"""

    card_id: str
    position: int
    name: str
    cover_blob_id: str | None


@dataclass(frozen=True, slots=True)
class ScenarioLorebookRef:
    """剧本挂的一本世界书（不带条目全文）。"""

    lorebook_id: str
    position: int
    name: str
    entries: int


@dataclass(frozen=True, slots=True)
class ScenarioRow:
    id: str
    user_id: str
    name: str
    setup: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime
    cards: tuple[ScenarioCardRef, ...] = ()
    lorebooks: tuple[ScenarioLorebookRef, ...] = ()

    @classmethod
    def from_row(cls, row: Row) -> ScenarioRow:
        refs = as_json(row.get("cards"), []) or []
        books = as_json(row.get("lorebooks"), []) or []
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            setup=as_json(row["setup"], {}) or {},
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            cards=tuple(
                ScenarioCardRef(
                    card_id=str(r["card_id"]),
                    position=int(r["position"]),
                    name=str(r["name"]),
                    cover_blob_id=opt_str(r.get("cover_blob_id")),
                )
                for r in sorted(refs, key=lambda r: int(r["position"]))
            ),
            lorebooks=tuple(
                ScenarioLorebookRef(
                    lorebook_id=str(b["lorebook_id"]),
                    position=int(b["position"]),
                    name=str(b["name"]),
                    entries=int(b["entries"]),
                )
                for b in sorted(books, key=lambda b: int(b["position"]))
            ),
        )


# 每个剧本带上它的几张卡、挂的几本世界书（都按位置排），一次查出来
_SCENARIO_SELECT = """
SELECT s.id, s.user_id, s.name, s.setup, s.version, s.created_at, s.updated_at,
       COALESCE((
           SELECT json_agg(json_build_object(
                      'card_id', c.id, 'position', sc.position, 'name', c.name,
                      'cover_blob_id', c.cover_blob_id) ORDER BY sc.position)
           FROM scenario_cards AS sc JOIN cards AS c ON c.id = sc.card_id
           WHERE sc.scenario_id = s.id
       ), '[]') AS cards,
       COALESCE((
           SELECT json_agg(json_build_object(
                      'lorebook_id', l.id, 'position', sl.position, 'name', l.name,
                      'entries', jsonb_array_length(l.book)) ORDER BY sl.position)
           FROM scenario_lorebooks AS sl JOIN lorebooks AS l ON l.id = sl.lorebook_id
           WHERE sl.scenario_id = s.id
       ), '[]') AS lorebooks
FROM scenarios AS s
"""


async def insert_scenario(
    conn: AsyncConnection,
    *,
    user_id: str,
    name: str,
    setup: dict[str, Any],
    card_ids: Sequence[str],
    lorebook_ids: Sequence[str] = (),
) -> ScenarioRow:
    row = await fetch_one(
        conn,
        """INSERT INTO scenarios (user_id, name, setup)
           VALUES (:u, :name, CAST(:setup AS jsonb)) RETURNING id""",
        {"u": user_id, "name": name, "setup": dumps(setup)},
    )
    assert row is not None
    scenario_id = str(row["id"])
    await _insert_cards(conn, scenario_id, card_ids)
    await _insert_lorebooks(conn, scenario_id, lorebook_ids)
    created = await get_scenario(conn, user_id, scenario_id)
    assert created is not None
    return created


async def _insert_cards(conn: AsyncConnection, scenario_id: str, card_ids: Sequence[str]) -> None:
    for position, card_id in enumerate(card_ids):
        await execute(
            conn,
            """INSERT INTO scenario_cards (scenario_id, card_id, position)
               VALUES (:s, :c, :p)""",
            {"s": scenario_id, "c": card_id, "p": position},
        )


async def _insert_lorebooks(
    conn: AsyncConnection, scenario_id: str, lorebook_ids: Sequence[str]
) -> None:
    for position, lorebook_id in enumerate(lorebook_ids):
        await execute(
            conn,
            """INSERT INTO scenario_lorebooks (scenario_id, lorebook_id, position)
               VALUES (:s, :l, :p)""",
            {"s": scenario_id, "l": lorebook_id, "p": position},
        )


async def list_scenarios(conn: AsyncConnection, user_id: str) -> list[ScenarioRow]:
    rows = await fetch_all(
        conn,
        f"{_SCENARIO_SELECT} WHERE s.user_id = :u ORDER BY s.updated_at DESC, s.id",
        {"u": user_id},
    )
    return [ScenarioRow.from_row(r) for r in rows]


async def get_scenario(
    conn: AsyncConnection, user_id: str, scenario_id: str, *, lock: bool = False
) -> ScenarioRow | None:
    row = await fetch_one(
        conn,
        f"{_SCENARIO_SELECT} WHERE s.id = :id AND s.user_id = :u"
        + (" FOR UPDATE OF s" if lock else ""),
        {"id": scenario_id, "u": user_id},
    )
    return None if row is None else ScenarioRow.from_row(row)


async def update_scenario(
    conn: AsyncConnection,
    user_id: str,
    scenario_id: str,
    *,
    name: str,
    setup: dict[str, Any],
    card_ids: Sequence[str] | None,
    expected_version: int | None,
    lorebook_ids: Sequence[str] | None = None,
) -> ScenarioRow | None:
    """改名字、设置，可选换卡、换世界书；版本号加 1。
    expected_version 对不上或剧本不存在时返回 None。"""
    row = await fetch_one(
        conn,
        """UPDATE scenarios
           SET name = :name, setup = CAST(:setup AS jsonb), version = version + 1,
               updated_at = now()
           WHERE id = :id AND user_id = :u AND (CAST(:v AS integer) IS NULL OR version = :v)
           RETURNING id""",
        {
            "id": scenario_id,
            "u": user_id,
            "name": name,
            "setup": dumps(setup),
            "v": expected_version,
        },
    )
    if row is None:
        return None
    if card_ids is not None:
        await execute(conn, "DELETE FROM scenario_cards WHERE scenario_id = :s", {"s": scenario_id})
        await _insert_cards(conn, scenario_id, card_ids)
    if lorebook_ids is not None:
        await execute(
            conn, "DELETE FROM scenario_lorebooks WHERE scenario_id = :s", {"s": scenario_id}
        )
        await _insert_lorebooks(conn, scenario_id, lorebook_ids)
    return await get_scenario(conn, user_id, scenario_id)


async def delete_scenario(conn: AsyncConnection, user_id: str, scenario_id: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM scenarios WHERE id = :id AND user_id = :u",
        {"id": scenario_id, "u": user_id},
    )
    return count > 0
