"""故事里的配图（turn_images，docs/illustrations.md）：点“画这一幕”插一行，后台画好或出错时改它。

读出来的每一行带 age_s（数据库算的、从点下去到现在过了几秒），超过时限的“还在画”按失败显示，
不依赖进程的时钟。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
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
    opt_str,
)

_COLS = """
    i.id, i.user_id, i.playthrough_id, i.turn_id, i.status, i.request, i.style, i.prompt,
    i.blob_id, i.error, i.meta, i.created_at,
    EXTRACT(EPOCH FROM (now() - i.created_at))::float8 AS age_s,
    b.width, b.height
"""
_FROM = "turn_images AS i LEFT JOIN blobs AS b ON b.id = i.blob_id"


@dataclass(frozen=True, slots=True)
class TurnImageRow:
    id: str
    user_id: str
    playthrough_id: str
    turn_id: str
    status: str
    request: str
    style: str
    prompt: str | None
    blob_id: str | None
    error: str | None
    meta: dict[str, Any]
    created_at: datetime
    age_s: float
    width: int | None
    height: int | None

    @classmethod
    def from_row(cls, row: Row) -> TurnImageRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            playthrough_id=str(row["playthrough_id"]),
            turn_id=str(row["turn_id"]),
            status=row["status"],
            request=row["request"],
            style=row["style"],
            prompt=row["prompt"],
            blob_id=opt_str(row["blob_id"]),
            error=row["error"],
            meta=as_json(row["meta"], {}),
            created_at=row["created_at"],
            age_s=float(row["age_s"] or 0.0),
            width=row["width"],
            height=row["height"],
        )


async def get_image(
    conn: AsyncConnection, image_id: str, user_id: str | None = None
) -> TurnImageRow | None:
    """一张图；给了 user_id 时只找这个人的。"""
    owner = "AND i.user_id = :u" if user_id is not None else ""
    row = await fetch_one(
        conn,
        f"SELECT {_COLS} FROM {_FROM} WHERE i.id = :id {owner}",
        {"id": image_id, "u": user_id},
    )
    return None if row is None else TurnImageRow.from_row(row)


async def list_for_turns(
    conn: AsyncConnection, turn_ids: Sequence[str]
) -> dict[str, list[TurnImageRow]]:
    """几个回合各自的图，按点下去的先后。"""
    ids = sorted(set(turn_ids))
    if not ids:
        return {}
    rows = await fetch_all(
        conn,
        f"""
        SELECT {_COLS} FROM {_FROM}
        WHERE i.turn_id = ANY(CAST(:ids AS uuid[])) ORDER BY i.created_at, i.id
        """,
        {"ids": as_uuid_list(ids)},
    )
    found: dict[str, list[TurnImageRow]] = {}
    for row in rows:
        image = TurnImageRow.from_row(row)
        found.setdefault(image.turn_id, []).append(image)
    return found


async def expire_pending(
    conn: AsyncConnection,
    *,
    deadline_s: int,
    turn_id: str | None = None,
    user_id: str | None = None,
) -> int:
    """把超过时限还在画的改成失败（timeout）：按回合或按人。"""
    where = "turn_id = :t" if turn_id is not None else "user_id = :u"
    return await execute(
        conn,
        f"""
        UPDATE turn_images SET status = 'failed', error = 'timeout', updated_at = now()
        WHERE {where} AND status = 'pending'
          AND created_at < now() - make_interval(secs => :deadline)
        """,
        {"t": turn_id, "u": user_id, "deadline": float(deadline_s)},
    )


async def count_pending(conn: AsyncConnection, user_id: str) -> int:
    return int(
        await fetch_value(
            conn,
            "SELECT count(*) FROM turn_images WHERE user_id = :u AND status = 'pending'",
            {"u": user_id},
        )
        or 0
    )


async def has_pending(conn: AsyncConnection, turn_id: str) -> bool:
    return bool(
        await fetch_value(
            conn,
            "SELECT EXISTS (SELECT 1 FROM turn_images WHERE turn_id = :t AND status = 'pending')",
            {"t": turn_id},
        )
    )


async def delete_failed(conn: AsyncConnection, turn_id: str) -> None:
    """重新画之前，去掉这一回合以前没画出来的记录。"""
    await execute(
        conn, "DELETE FROM turn_images WHERE turn_id = :t AND status = 'failed'", {"t": turn_id}
    )


async def insert_image(
    conn: AsyncConnection,
    *,
    user_id: str,
    playthrough_id: str,
    turn_id: str,
    request: str,
    style: str,
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO turn_images (user_id, playthrough_id, turn_id, request, style)
        VALUES (:u, :pt, :t, :request, :style)
        RETURNING id
        """,
        {"u": user_id, "pt": playthrough_id, "t": turn_id, "request": request, "style": style},
    )
    assert row is not None
    return str(row["id"])


async def claim_ready(
    conn: AsyncConnection, image_id: str, *, deadline_s: int, prompt: str, meta: Mapping[str, Any]
) -> bool:
    """画好了：还在画、没超时才改成 ready（带条件的 UPDATE，先于写图片）。"""
    count = await execute(
        conn,
        """
        UPDATE turn_images
           SET status = 'ready', prompt = :prompt, meta = CAST(:meta AS jsonb), updated_at = now()
         WHERE id = :id AND status = 'pending'
           AND created_at >= now() - make_interval(secs => :deadline)
        """,
        {
            "id": image_id,
            "prompt": prompt,
            "meta": dumps(dict(meta)),
            "deadline": float(deadline_s),
        },
    )
    return count == 1


async def set_blob(conn: AsyncConnection, image_id: str, blob_id: str) -> None:
    await execute(
        conn, "UPDATE turn_images SET blob_id = :b WHERE id = :id", {"id": image_id, "b": blob_id}
    )


async def mark_failed(
    conn: AsyncConnection,
    image_id: str,
    *,
    error: str,
    prompt: str | None = None,
    meta: Mapping[str, Any] | None = None,
) -> bool:
    count = await execute(
        conn,
        """
        UPDATE turn_images
           SET status = 'failed', error = :error, prompt = COALESCE(:prompt, prompt),
               meta = meta || CAST(:meta AS jsonb), updated_at = now()
         WHERE id = :id AND status = 'pending'
        """,
        {"id": image_id, "error": error, "prompt": prompt, "meta": dumps(dict(meta or {}))},
    )
    return count == 1


async def delete_others(conn: AsyncConnection, turn_id: str, keep_id: str) -> list[str]:
    """新的一张画好了：同一回合别的几行（旧图、失败的记录）删掉，返回它们用的图片。"""
    rows = await fetch_all(
        conn,
        """
        DELETE FROM turn_images WHERE turn_id = :t AND id <> :keep AND status <> 'pending'
        RETURNING blob_id
        """,
        {"t": turn_id, "keep": keep_id},
    )
    return [str(r["blob_id"]) for r in rows if r["blob_id"] is not None]


async def delete_image(conn: AsyncConnection, image_id: str, user_id: str) -> str | None:
    """删一行，返回它用的图片（没有图片时是空串）；没找到返回 None。"""
    row = await fetch_one(
        conn,
        "DELETE FROM turn_images WHERE id = :id AND user_id = :u RETURNING blob_id",
        {"id": image_id, "u": user_id},
    )
    if row is None:
        return None
    return opt_str(row["blob_id"]) or ""


async def playthrough_blobs(conn: AsyncConnection, playthrough_id: str) -> list[str]:
    """一局所有配图用的图片（删这一局时，之后清理没人用的图片）。"""
    rows = await fetch_all(
        conn,
        "SELECT blob_id FROM turn_images WHERE playthrough_id = :pt AND blob_id IS NOT NULL",
        {"pt": playthrough_id},
    )
    return [str(r["blob_id"]) for r in rows]
