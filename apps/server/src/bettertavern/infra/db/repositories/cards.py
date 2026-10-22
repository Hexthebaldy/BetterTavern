"""角色卡仓库：cards 与 card_revisions。

每次正式保存（新建、草稿保存回来、恢复旧版）版本号加 1，并记一份 card_revisions；
每张卡最多留 30 份。
写回已有的卡带着开草稿时的版本号，对不上（别处改过）就不写，由调用方返回 409。
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

MAX_REVISIONS = 30


@dataclass(frozen=True, slots=True)
class CardRow:
    id: str
    user_id: str
    name: str
    source: str
    source_sha256: str | None
    card: dict[str, Any]
    cover_blob_id: str | None
    meta: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime
    # 列表才查的两项：几个剧本在用，以及有没有没保存的草稿（有就是那份草稿的 id）
    scenario_count: int = 0
    draft_id: str | None = None

    @classmethod
    def from_row(cls, row: Row) -> CardRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            source=row["source"],
            source_sha256=row["source_sha256"],
            card=as_json(row["card"], {}) or {},
            cover_blob_id=opt_str(row["cover_blob_id"]),
            meta=as_json(row["meta"], {}) or {},
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            scenario_count=int(row.get("scenario_count") or 0),
            draft_id=opt_str(row.get("draft_id")),
        )


_COLS = """c.id, c.user_id, c.name, c.source, c.source_sha256, c.card, c.cover_blob_id, c.meta,
    c.version, c.created_at, c.updated_at"""

_EXTRA = """,
    (SELECT count(*) FROM scenario_cards AS sc WHERE sc.card_id = c.id) AS scenario_count,
    (SELECT d.id FROM workbench_drafts AS d
      WHERE d.card_id = c.id AND (d.saved_version IS NULL OR d.saved_version <> d.version)
      ORDER BY d.updated_at DESC LIMIT 1) AS draft_id"""


async def insert_card(
    conn: AsyncConnection,
    *,
    user_id: str,
    name: str,
    source: str,
    source_sha256: str | None,
    raw: Any,
    card: dict[str, Any],
    cover_blob_id: str | None,
    meta: dict[str, Any],
) -> CardRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO cards AS c
            (user_id, name, source, source_sha256, raw, card, cover_blob_id, meta)
        VALUES (:u, :name, :source, :sha, CAST(:raw AS jsonb), CAST(:card AS jsonb), :cover,
                CAST(:meta AS jsonb))
        RETURNING {_COLS}
        """,
        {
            "u": user_id,
            "name": name,
            "source": source,
            "sha": source_sha256,
            "raw": None if raw is None else dumps(raw),
            "card": dumps(card),
            "cover": cover_blob_id,
            "meta": dumps(meta),
        },
    )
    assert row is not None
    return CardRow.from_row(row)


async def find_card_by_sha(conn: AsyncConnection, user_id: str, sha256: str) -> CardRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM cards AS c WHERE c.user_id = :u AND c.source_sha256 = :sha",
        {"u": user_id, "sha": sha256},
    )
    return None if row is None else CardRow.from_row(row)


async def list_cards(conn: AsyncConnection, user_id: str) -> list[CardRow]:
    rows = await fetch_all(
        conn,
        f"""SELECT {_COLS}{_EXTRA} FROM cards AS c WHERE c.user_id = :u
            ORDER BY c.updated_at DESC, c.id""",
        {"u": user_id},
    )
    return [CardRow.from_row(r) for r in rows]


async def get_card(
    conn: AsyncConnection, user_id: str, card_id: str, *, lock: bool = False
) -> CardRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS}{_EXTRA} FROM cards AS c WHERE c.id = :id AND c.user_id = :u"
        + (" FOR UPDATE OF c" if lock else ""),
        {"id": card_id, "u": user_id},
    )
    return None if row is None else CardRow.from_row(row)


async def get_cards(conn: AsyncConnection, user_id: str, card_ids: Sequence[str]) -> list[CardRow]:
    """按给定的顺序返回；不存在或不是这个用户的卡不返回。"""
    if not card_ids:
        return []
    rows = await fetch_all(
        conn,
        f"SELECT {_COLS} FROM cards AS c WHERE c.user_id = :u AND c.id = ANY(CAST(:ids AS uuid[]))",
        {"u": user_id, "ids": as_uuid_list(card_ids)},
    )
    by_id = {str(r["id"]): CardRow.from_row(r) for r in rows}
    return [by_id[i] for i in card_ids if i in by_id]


async def get_card_raw(conn: AsyncConnection, user_id: str, card_id: str) -> Any | None:
    row = await fetch_one(
        conn,
        "SELECT raw FROM cards WHERE id = :id AND user_id = :u",
        {"id": card_id, "u": user_id},
    )
    return None if row is None else as_json(row["raw"])


async def update_card(
    conn: AsyncConnection,
    user_id: str,
    card_id: str,
    *,
    name: str,
    card: dict[str, Any],
    cover_blob_id: str | None,
    meta: dict[str, Any],
    expected_version: int | None,
) -> CardRow | None:
    """写回一张卡，版本号加 1。expected_version 不为空时必须相等（版本围栏），否则返回 None。"""
    row = await fetch_one(
        conn,
        f"""UPDATE cards AS c
            SET name = :name, card = CAST(:card AS jsonb), cover_blob_id = :cover,
                meta = CAST(:meta AS jsonb), version = c.version + 1, updated_at = now()
            WHERE c.id = :id AND c.user_id = :u
              AND (CAST(:v AS integer) IS NULL OR c.version = :v)
            RETURNING {_COLS}""",
        {
            "id": card_id,
            "u": user_id,
            "name": name,
            "card": dumps(card),
            "cover": cover_blob_id,
            "meta": dumps(meta),
            "v": expected_version,
        },
    )
    return None if row is None else CardRow.from_row(row)


async def scenarios_using(conn: AsyncConnection, card_id: str) -> list[tuple[str, str]]:
    """哪些剧本在用这张卡：[(剧本 id, 剧本名)]，按剧本名排。"""
    rows = await fetch_all(
        conn,
        """SELECT s.id, s.name
           FROM scenario_cards AS sc JOIN scenarios AS s ON s.id = sc.scenario_id
           WHERE sc.card_id = :c ORDER BY s.name, s.id""",
        {"c": card_id},
    )
    return [(str(r["id"]), r["name"]) for r in rows]


async def delete_card(conn: AsyncConnection, user_id: str, card_id: str) -> list[str] | None:
    """删掉卡（版本历史一起删），返回它和它的版本用过的封面 blob id，由调用方清理没人用的图。
    不存在时返回 None。有剧本在用时数据库会拒绝（ON DELETE RESTRICT），
    调用方先查 scenarios_using。"""
    rows = await fetch_all(
        conn,
        """SELECT cover_blob_id FROM card_revisions
           WHERE card_id = :id AND cover_blob_id IS NOT NULL
           UNION SELECT cover_blob_id FROM cards WHERE id = :id AND cover_blob_id IS NOT NULL""",
        {"id": card_id},
    )
    deleted = await execute(
        conn, "DELETE FROM cards WHERE id = :id AND user_id = :u", {"id": card_id, "u": user_id}
    )
    if deleted == 0:
        return None
    return [str(r["cover_blob_id"]) for r in rows]


# ---- card_revisions ----


@dataclass(frozen=True, slots=True)
class RevisionRow:
    card_id: str
    version: int
    name: str
    card: dict[str, Any]
    cover_blob_id: str | None
    draft_id: str | None
    note: str
    created_at: datetime


async def insert_revision(
    conn: AsyncConnection,
    *,
    card: CardRow,
    draft_id: str | None,
    note: str,
) -> list[str]:
    """记下 card 当前的样子，并删掉超出 30 份的旧版本；返回被删版本用过的封面（交给调用方清理）。"""
    await execute(
        conn,
        """INSERT INTO card_revisions (card_id, version, name, card, cover_blob_id, draft_id, note)
           VALUES (:c, :v, :name, CAST(:card AS jsonb), :cover, :draft, :note)""",
        {
            "c": card.id,
            "v": card.version,
            "name": card.name,
            "card": dumps(card.card),
            "cover": card.cover_blob_id,
            "draft": draft_id,
            "note": note[:200],
        },
    )
    rows = await fetch_all(
        conn,
        """DELETE FROM card_revisions
           WHERE card_id = :c AND version <= CAST(:cutoff AS integer)
           RETURNING cover_blob_id""",
        {"c": card.id, "cutoff": card.version - MAX_REVISIONS},
    )
    return [str(r["cover_blob_id"]) for r in rows if r["cover_blob_id"] is not None]


def _revision(row: Row) -> RevisionRow:
    return RevisionRow(
        card_id=str(row["card_id"]),
        version=row["version"],
        name=row["name"],
        card=as_json(row["card"], {}) or {},
        cover_blob_id=opt_str(row["cover_blob_id"]),
        draft_id=opt_str(row["draft_id"]),
        note=row["note"],
        created_at=row["created_at"],
    )


async def list_revisions(conn: AsyncConnection, card_id: str) -> list[RevisionRow]:
    rows = await fetch_all(
        conn,
        """SELECT card_id, version, name, card, cover_blob_id, draft_id, note, created_at
           FROM card_revisions WHERE card_id = :c ORDER BY version DESC""",
        {"c": card_id},
    )
    return [_revision(r) for r in rows]


async def get_revision(conn: AsyncConnection, card_id: str, version: int) -> RevisionRow | None:
    row = await fetch_one(
        conn,
        """SELECT card_id, version, name, card, cover_blob_id, draft_id, note, created_at
           FROM card_revisions WHERE card_id = :c AND version = :v""",
        {"c": card_id, "v": version},
    )
    return None if row is None else _revision(row)
