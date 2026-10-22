"""读过的网页（web_pages）和资料笔记（workbench_notes）。

网页按用户分开存，不在用户之间共享；同一个地址 24 小时内再读直接用这里的结果，
7 天以后由维护任务清理。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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

PAGE_COLS = "id, url, final_url, title, content, fetcher"


@dataclass(frozen=True, slots=True)
class PageRow:
    id: str
    url: str
    final_url: str | None
    title: str
    content: str
    fetcher: str

    @classmethod
    def from_row(cls, row: Row) -> PageRow:
        return cls(
            id=str(row["id"]),
            url=row["url"],
            final_url=opt_str(row["final_url"]),
            title=row["title"],
            content=row["content"],
            fetcher=row["fetcher"],
        )


async def cached_page(
    conn: AsyncConnection, user_id: str, url_hash: str, *, max_age_s: int
) -> PageRow | None:
    row = await fetch_one(
        conn,
        f"""SELECT {PAGE_COLS} FROM web_pages
            WHERE user_id = :u AND url_hash = :h
              AND fetched_at > now() - make_interval(secs => :age)
            ORDER BY fetched_at DESC LIMIT 1""",
        {"u": user_id, "h": url_hash, "age": max_age_s},
    )
    return None if row is None else PageRow.from_row(row)


async def insert_page(
    conn: AsyncConnection,
    user_id: str,
    *,
    url: str,
    url_hash: str,
    final_url: str | None,
    title: str,
    content: str,
    fetcher: str,
) -> str:
    row = await fetch_one(
        conn,
        """INSERT INTO web_pages (user_id, url, url_hash, final_url, title, content, fetcher)
           VALUES (:u, :url, :h, :final, :title, :content, :fetcher) RETURNING id""",
        {
            "u": user_id,
            "url": url,
            "h": url_hash,
            "final": final_url,
            "title": title,
            "content": content,
            "fetcher": fetcher,
        },
    )
    assert row is not None
    return str(row["id"])


async def get_page(conn: AsyncConnection, user_id: str, page_id: str) -> PageRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {PAGE_COLS} FROM web_pages WHERE id = :id AND user_id = :u",
        {"id": page_id, "u": user_id},
    )
    return None if row is None else PageRow.from_row(row)


async def delete_old_pages(conn: AsyncConnection, *, older_than_s: int) -> int:
    return await execute(
        conn,
        "DELETE FROM web_pages WHERE fetched_at < now() - make_interval(secs => :s)",
        {"s": older_than_s},
    )


@dataclass(frozen=True, slots=True)
class NoteRow:
    id: str
    text: str
    source: dict[str, Any]
    used_in: list[str]


async def insert_note(
    conn: AsyncConnection,
    draft_id: str,
    *,
    text: str,
    source: Mapping[str, Any],
    used_in: Sequence[str],
) -> str:
    row = await fetch_one(
        conn,
        """INSERT INTO workbench_notes (draft_id, text, source, used_in)
           VALUES (:d, :t, CAST(:s AS jsonb), CAST(:u AS jsonb)) RETURNING id""",
        {"d": draft_id, "t": text, "s": dumps(source), "u": dumps(list(used_in))},
    )
    assert row is not None
    return str(row["id"])


async def list_notes(conn: AsyncConnection, draft_id: str) -> list[NoteRow]:
    rows = await fetch_all(
        conn,
        """SELECT id, text, source, used_in FROM workbench_notes
           WHERE draft_id = :d ORDER BY created_at, id""",
        {"d": draft_id},
    )
    return [
        NoteRow(
            id=str(r["id"]),
            text=r["text"],
            source=as_json(r["source"], {}) or {},
            used_in=[str(x) for x in as_json(r["used_in"], []) or []],
        )
        for r in rows
    ]
