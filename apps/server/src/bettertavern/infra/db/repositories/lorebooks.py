"""世界书仓库：lorebooks（docs/lorebook.md）。剧本挂了哪几本在 scenario_lorebooks
（读写在 library.py）。

改名字、简介、条目都带着读到的版本号，对不上（别处改过）就不写，由调用方返回 409；版本号每次加 1。
列表不读条目全文，只在数据库里数条目数和常驻条数。
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
    fetch_value,
)


@dataclass(frozen=True, slots=True)
class LorebookRow:
    id: str
    user_id: str
    name: str
    description: str
    source: str
    source_sha256: str | None
    report: dict[str, Any]
    version: int
    created_at: datetime
    updated_at: datetime
    entries: int  # 条目数
    constant: int  # 常驻条数
    scenario_count: int  # 几个剧本挂着它
    book: list[dict[str, Any]] | None = None  # 只有读一本时才带条目全文

    @classmethod
    def from_row(cls, row: Row) -> LorebookRow:
        book = as_json(row.get("book"))
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            description=row["description"],
            source=row["source"],
            source_sha256=row["source_sha256"],
            report=as_json(row["report"], {}) or {},
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            entries=int(row["entries"]),
            constant=int(row["constant"]),
            scenario_count=int(row["scenario_count"]),
            book=book if isinstance(book, list) else None,
        )


_COLS = """l.id, l.user_id, l.name, l.description, l.source, l.source_sha256, l.report,
    l.version, l.created_at, l.updated_at,
    jsonb_array_length(l.book) AS entries,
    (SELECT count(*) FROM jsonb_array_elements(l.book) AS e
      WHERE e->>'constant' = 'true') AS constant,
    (SELECT count(*) FROM scenario_lorebooks AS sl WHERE sl.lorebook_id = l.id) AS scenario_count"""


async def count_lorebooks(conn: AsyncConnection, user_id: str) -> int:
    value = await fetch_value(
        conn, "SELECT count(*) FROM lorebooks WHERE user_id = :u", {"u": user_id}
    )
    return int(value or 0)


async def insert_lorebook(
    conn: AsyncConnection,
    *,
    user_id: str,
    name: str,
    description: str,
    source: str,
    source_sha256: str | None,
    raw: Any,
    book: list[dict[str, Any]],
    report: dict[str, Any],
) -> LorebookRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO lorebooks AS l
            (user_id, name, description, source, source_sha256, raw, book, report)
        VALUES (:u, :name, :description, :source, :sha, CAST(:raw AS jsonb),
                CAST(:book AS jsonb), CAST(:report AS jsonb))
        RETURNING {_COLS}, l.book
        """,
        {
            "u": user_id,
            "name": name,
            "description": description,
            "source": source,
            "sha": source_sha256,
            "raw": None if raw is None else dumps(raw),
            "book": dumps(book),
            "report": dumps(report),
        },
    )
    assert row is not None
    return LorebookRow.from_row(row)


async def find_by_sha(conn: AsyncConnection, user_id: str, sha256: str) -> LorebookRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM lorebooks AS l WHERE l.user_id = :u AND l.source_sha256 = :sha",
        {"u": user_id, "sha": sha256},
    )
    return None if row is None else LorebookRow.from_row(row)


async def list_lorebooks(conn: AsyncConnection, user_id: str) -> list[LorebookRow]:
    rows = await fetch_all(
        conn,
        f"""SELECT {_COLS} FROM lorebooks AS l WHERE l.user_id = :u
            ORDER BY l.updated_at DESC, l.id""",
        {"u": user_id},
    )
    return [LorebookRow.from_row(r) for r in rows]


async def get_lorebook(
    conn: AsyncConnection, user_id: str, lorebook_id: str, *, lock: bool = False
) -> LorebookRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_COLS}, l.book FROM lorebooks AS l WHERE l.id = :id AND l.user_id = :u"
        + (" FOR UPDATE OF l" if lock else ""),
        {"id": lorebook_id, "u": user_id},
    )
    return None if row is None else LorebookRow.from_row(row)


async def get_lorebooks(
    conn: AsyncConnection, user_id: str, lorebook_ids: Sequence[str]
) -> list[LorebookRow]:
    """这几本（带条目全文），按传入的顺序；不存在或不是这个用户的不返回。"""
    if not lorebook_ids:
        return []
    rows = await fetch_all(
        conn,
        f"""SELECT {_COLS}, l.book FROM lorebooks AS l
            WHERE l.user_id = :u AND l.id = ANY(CAST(:ids AS uuid[]))""",
        {"u": user_id, "ids": as_uuid_list(list(lorebook_ids))},
    )
    by_id = {str(r["id"]): LorebookRow.from_row(r) for r in rows}
    return [by_id[i] for i in lorebook_ids if i in by_id]


async def update_meta(
    conn: AsyncConnection,
    user_id: str,
    lorebook_id: str,
    *,
    name: str,
    description: str,
    expected_version: int,
) -> LorebookRow | None:
    row = await fetch_one(
        conn,
        f"""UPDATE lorebooks AS l
            SET name = :name, description = :description, version = version + 1,
                updated_at = now()
            WHERE l.id = :id AND l.user_id = :u AND l.version = :v
            RETURNING {_COLS}, l.book""",
        {
            "id": lorebook_id,
            "u": user_id,
            "name": name,
            "description": description,
            "v": expected_version,
        },
    )
    return None if row is None else LorebookRow.from_row(row)


async def update_book(
    conn: AsyncConnection,
    user_id: str,
    lorebook_id: str,
    *,
    book: list[dict[str, Any]],
    expected_version: int,
) -> LorebookRow | None:
    row = await fetch_one(
        conn,
        f"""UPDATE lorebooks AS l
            SET book = CAST(:book AS jsonb), version = version + 1, updated_at = now()
            WHERE l.id = :id AND l.user_id = :u AND l.version = :v
            RETURNING {_COLS}, l.book""",
        {"id": lorebook_id, "u": user_id, "book": dumps(book), "v": expected_version},
    )
    return None if row is None else LorebookRow.from_row(row)


async def delete_lorebook(conn: AsyncConnection, user_id: str, lorebook_id: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM lorebooks WHERE id = :id AND user_id = :u",
        {"id": lorebook_id, "u": user_id},
    )
    return count > 0


async def scenarios_using(conn: AsyncConnection, lorebook_id: str) -> list[tuple[str, str]]:
    """挂着这本书的剧本（id, 名字），按名字排。"""
    rows = await fetch_all(
        conn,
        """SELECT s.id, s.name FROM scenario_lorebooks AS sl
           JOIN scenarios AS s ON s.id = sl.scenario_id
           WHERE sl.lorebook_id = :id ORDER BY s.name, s.id""",
        {"id": lorebook_id},
    )
    return [(str(r["id"]), r["name"]) for r in rows]


async def owned_ids(conn: AsyncConnection, user_id: str, lorebook_ids: Sequence[str]) -> set[str]:
    """这几本里哪些存在、是这个用户的（挂到剧本前检查用，不读条目）。"""
    if not lorebook_ids:
        return set()
    rows = await fetch_all(
        conn,
        "SELECT id FROM lorebooks WHERE user_id = :u AND id = ANY(CAST(:ids AS uuid[]))",
        {"u": user_id, "ids": as_uuid_list(list(lorebook_ids))},
    )
    return {str(r["id"]) for r in rows}
