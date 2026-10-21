"""整理出来的记忆：章节摘要、全书梗概（story_summaries）、玩家画像（player_profiles），
以及存档上“章节摘要已经覆盖到第几回合”（playthroughs.summarized_seq）。

写入顺序见 docs/agent-runtime.md 第 8 节：先对 playthroughs 做带条件的 UPDATE（覆盖进度和时间线编号
都要对得上），成功后才写摘要和画像。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import as_json, execute, fetch_all, fetch_one

CHAPTER = "chapter"
SYNOPSIS = "synopsis"


@dataclass(frozen=True, slots=True)
class SummaryRow:
    first_seq: int
    last_seq: int
    text: str


@dataclass(frozen=True, slots=True)
class MemoryRows:
    synopsis: SummaryRow | None  # 最新一版全书梗概
    chapters: tuple[SummaryRow, ...]  # 还没并进梗概的章节摘要，按回合升序
    profile: str  # 最新一版玩家画像，没有时为空


async def load_memory(conn: AsyncConnection, playthrough_id: str) -> MemoryRows:
    synopsis = await fetch_one(
        conn,
        """
        SELECT first_seq, last_seq, text FROM story_summaries
        WHERE playthrough_id = :pt AND kind = 'synopsis'
        ORDER BY last_seq DESC LIMIT 1
        """,
        {"pt": playthrough_id},
    )
    covered = int(synopsis["last_seq"]) if synopsis is not None else -1
    chapters = await fetch_all(
        conn,
        """
        SELECT first_seq, last_seq, text FROM story_summaries
        WHERE playthrough_id = :pt AND kind = 'chapter' AND last_seq > :covered
        ORDER BY last_seq
        """,
        {"pt": playthrough_id, "covered": covered},
    )
    profile = await fetch_one(
        conn,
        """
        SELECT text FROM player_profiles WHERE playthrough_id = :pt
        ORDER BY created_at DESC, id DESC LIMIT 1
        """,
        {"pt": playthrough_id},
    )
    return MemoryRows(
        synopsis=_row(synopsis) if synopsis is not None else None,
        chapters=tuple(_row(r) for r in chapters),
        profile=profile["text"] if profile is not None else "",
    )


def _row(row: Any) -> SummaryRow:
    return SummaryRow(int(row["first_seq"]), int(row["last_seq"]), row["text"])


@dataclass(frozen=True, slots=True)
class ChapterTurnRow:
    turn_id: str
    seq: int
    user_action: dict[str, Any]
    narrative: str
    scene_ended: bool


async def chapter_turns(
    conn: AsyncConnection, playthrough_id: str, *, after_seq: int, up_to_seq: int
) -> list[ChapterTurnRow]:
    """当前故事线上 after_seq 之后、到 up_to_seq 为止的回合，带回合标签，按回合升序。"""
    rows = await fetch_all(
        conn,
        """
        SELECT t.id, t.seq, t.user_action, t.narrative, n.scene_ended
        FROM turns AS t LEFT JOIN turn_notes AS n ON n.turn_id = t.id
        WHERE t.playthrough_id = :pt AND t.seq > :after AND t.seq <= :upto
          AND t.status IN ('replied', 'committed')
        ORDER BY t.seq
        """,
        {"pt": playthrough_id, "after": after_seq, "upto": up_to_seq},
    )
    return [
        ChapterTurnRow(
            turn_id=str(r["id"]),
            seq=int(r["seq"]),
            user_action=as_json(r["user_action"], {}),
            narrative=r["narrative"],
            scene_ended=bool(r["scene_ended"]),
        )
        for r in rows
    ]


async def advance_summarized(
    conn: AsyncConnection, playthrough_id: str, *, first_seq: int, last_seq: int, epoch: int
) -> bool:
    """章节摘要的覆盖进度从 first_seq − 1 前进到 last_seq。
    期间回退过、或者这一章已经写过，返回 False。"""
    count = await execute(
        conn,
        """
        UPDATE playthroughs SET summarized_seq = :last
        WHERE id = :id AND summarized_seq = :first - 1 AND timeline_epoch = :epoch
        """,
        {"id": playthrough_id, "first": first_seq, "last": last_seq, "epoch": epoch},
    )
    return count == 1


async def insert_summary(
    conn: AsyncConnection,
    playthrough_id: str,
    *,
    kind: str,
    first_seq: int,
    last_seq: int,
    written_seq: int,
    text: str,
) -> None:
    """written_seq：写它时章节摘要覆盖到第几回合（也就是这次写的那一章的最后一回合）。"""
    await execute(
        conn,
        """
        INSERT INTO story_summaries (playthrough_id, kind, first_seq, last_seq, written_seq, text)
        VALUES (:pt, :kind, :first, :last, :written, :text)
        """,
        {
            "pt": playthrough_id,
            "kind": kind,
            "first": first_seq,
            "last": last_seq,
            "written": written_seq,
            "text": text,
        },
    )


async def insert_profile(
    conn: AsyncConnection, playthrough_id: str, *, text: str, based_on_seq: int
) -> None:
    await execute(
        conn,
        """
        INSERT INTO player_profiles (playthrough_id, text, based_on_seq)
        VALUES (:pt, :text, :seq)
        """,
        {"pt": playthrough_id, "text": text, "seq": based_on_seq},
    )


async def delete_after(conn: AsyncConnection, playthrough_id: str, seq: int) -> int:
    """回退到第 seq 回合：在它之后写的摘要（章节摘要、全书梗概）删掉，和只玩到它时一样；
    章节摘要的覆盖进度改回剩下的最后一章。玩家画像不动。返回删了几条。"""
    deleted = await execute(
        conn,
        "DELETE FROM story_summaries WHERE playthrough_id = :pt AND written_seq > :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    await execute(
        conn,
        """
        UPDATE playthroughs SET summarized_seq = COALESCE(
            (SELECT max(last_seq) FROM story_summaries
             WHERE playthrough_id = :pt AND kind = 'chapter'),
            -1)
        WHERE id = :pt
        """,
        {"pt": playthrough_id},
    )
    return deleted
