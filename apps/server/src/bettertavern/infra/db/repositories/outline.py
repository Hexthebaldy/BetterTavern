"""大纲：修订的每一次决定（outline_revisions）、存档上“大纲修订已经看过第几回合的原因”
（playthroughs.outline_seq），以及世界状态 agent 写在回合标签上的“大纲要改”的原因
（turn_notes.outline_reason）。

写入顺序见 docs/agent-runtime.md 第 8 节：先对 playthroughs 做带条件的 UPDATE（outline_seq 和
时间线编号都要对得上），成功后才写修订。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import as_json, dumps, execute, fetch_all, fetch_one, fetch_value


@dataclass(frozen=True, slots=True)
class OutlineRow:
    based_on_seq: int
    content: dict[str, Any]


async def current_outline(conn: AsyncConnection, playthrough_id: str) -> OutlineRow | None:
    """最新一版大纲（改过的那些决定里最晚的一次）；还没有大纲时返回 None。"""
    row = await fetch_one(
        conn,
        """
        SELECT based_on_seq, content FROM outline_revisions
        WHERE playthrough_id = :pt AND changed
        ORDER BY based_on_seq DESC LIMIT 1
        """,
        {"pt": playthrough_id},
    )
    if row is None:
        return None
    return OutlineRow(int(row["based_on_seq"]), as_json(row["content"], {}))


async def pending_reasons(
    conn: AsyncConnection, playthrough_id: str, *, after_seq: int, up_to_seq: int
) -> list[tuple[int, str]]:
    """after_seq 之后、到 up_to_seq 为止，世界状态 agent 说“大纲要改”的回合和原因，按回合升序。"""
    rows = await fetch_all(
        conn,
        """
        SELECT seq, outline_reason FROM turn_notes
        WHERE playthrough_id = :pt AND seq > :after AND seq <= :upto AND outline_reason <> ''
        ORDER BY seq
        """,
        {"pt": playthrough_id, "after": after_seq, "upto": up_to_seq},
    )
    return [(int(r["seq"]), r["outline_reason"]) for r in rows]


async def has_pending(conn: AsyncConnection, playthrough_id: str, *, after_seq: int) -> bool:
    value = await fetch_value(
        conn,
        """
        SELECT EXISTS (SELECT 1 FROM turn_notes
                       WHERE playthrough_id = :pt AND seq > :after AND outline_reason <> '')
        """,
        {"pt": playthrough_id, "after": after_seq},
    )
    return bool(value)


async def recent_digests(
    conn: AsyncConnection, playthrough_id: str, *, after_seq: int, up_to_seq: int, limit: int
) -> list[tuple[int, str]]:
    """after_seq 之后、到 up_to_seq 为止最近 limit 回合的一句话摘要，按回合升序。"""
    rows = await fetch_all(
        conn,
        """
        SELECT seq, digest FROM turn_notes
        WHERE playthrough_id = :pt AND seq > :after AND seq <= :upto AND digest <> ''
        ORDER BY seq DESC LIMIT :limit
        """,
        {"pt": playthrough_id, "after": after_seq, "upto": up_to_seq, "limit": limit},
    )
    return [(int(r["seq"]), r["digest"]) for r in reversed(rows)]


async def note_turn_id(conn: AsyncConnection, playthrough_id: str, seq: int) -> str | None:
    """第 seq 回合的回合标签记在哪一回合上（修订的运行记录挂在它上面）。"""
    value = await fetch_value(
        conn,
        "SELECT turn_id FROM turn_notes WHERE playthrough_id = :pt AND seq = :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    return str(value) if value is not None else None


async def advance_outline(
    conn: AsyncConnection, playthrough_id: str, *, from_seq: int, to_seq: int, epoch: int
) -> bool:
    """大纲修订的进度从 from_seq 前进到 to_seq。期间回退过、或者这次已经修订过，返回 False。"""
    count = await execute(
        conn,
        """
        UPDATE playthroughs SET outline_seq = :to
        WHERE id = :id AND outline_seq = :from AND timeline_epoch = :epoch
        """,
        {"id": playthrough_id, "from": from_seq, "to": to_seq, "epoch": epoch},
    )
    return count == 1


async def insert_revision(
    conn: AsyncConnection,
    playthrough_id: str,
    *,
    based_on_seq: int,
    content: dict[str, Any] | None,
    reason: str,
) -> None:
    await execute(
        conn,
        """
        INSERT INTO outline_revisions (playthrough_id, based_on_seq, changed, content, reason)
        VALUES (:pt, :seq, :changed, CAST(:content AS jsonb), :reason)
        """,
        {
            "pt": playthrough_id,
            "seq": based_on_seq,
            "changed": content is not None,
            "content": dumps(content) if content is not None else None,
            "reason": reason,
        },
    )


async def delete_after(conn: AsyncConnection, playthrough_id: str, seq: int) -> int:
    """回退到第 seq 回合：依据到它之后的修订删掉，修订进度改回剩下的最后一次。返回删了几条。"""
    deleted = await execute(
        conn,
        "DELETE FROM outline_revisions WHERE playthrough_id = :pt AND based_on_seq > :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    await execute(
        conn,
        """
        UPDATE playthroughs SET outline_seq = COALESCE(
            (SELECT max(based_on_seq) FROM outline_revisions WHERE playthrough_id = :pt), -1)
        WHERE id = :pt
        """,
        {"pt": playthrough_id},
    )
    return deleted
