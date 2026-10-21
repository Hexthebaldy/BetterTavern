"""导演召回工具的查询（docs/agent-runtime.md 第 7 节“召回”）：按回合标签里的实体找回合、
按关键词在这一局的文字里找回合、取某一回合的原文。

只看当前故事线：回合状态是 replied 或 committed（失败的尝试、回退时归档的回合都不算）。
关键词不建索引，直接逐条找：一局最多几千回合、几 MB 文字，几毫秒就够。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, as_json, fetch_all, fetch_one

LIVE = "('replied', 'committed')"


@dataclass(frozen=True, slots=True)
class PastTurnRow:
    seq: int
    user_action: dict[str, Any]
    narrative: str
    digest: str

    @classmethod
    def from_row(cls, row: Row) -> PastTurnRow:
        return cls(
            seq=int(row["seq"]),
            user_action=as_json(row["user_action"], {}),
            narrative=row["narrative"],
            digest=row["digest"] or "",
        )


async def turns_with_entities(
    conn: AsyncConnection,
    playthrough_id: str,
    entity_ids: Sequence[str],
    *,
    before_seq: int,
    limit: int,
) -> list[PastTurnRow]:
    rows = await fetch_all(
        conn,
        f"""
        SELECT t.seq, t.user_action, t.narrative, n.digest
        FROM turn_notes AS n JOIN turns AS t ON t.id = n.turn_id
        WHERE n.playthrough_id = :pt AND n.seq < :before
          AND n.entity_ids && CAST(:ids AS uuid[]) AND t.status IN {LIVE}
        ORDER BY n.seq DESC LIMIT :limit
        """,
        {"pt": playthrough_id, "before": before_seq, "ids": list(entity_ids), "limit": limit},
    )
    return [PastTurnRow.from_row(r) for r in rows]


async def search_turns(
    conn: AsyncConnection,
    playthrough_id: str,
    terms: Sequence[str],
    *,
    before_seq: int,
    limit: int,
) -> list[PastTurnRow]:
    """玩家行动、叙述或一句话摘要里包含任一关键词（不分大小写）的回合，从近到远。
    用 strpos 而不是 LIKE：关键词里的 % 和 _ 不会被当成通配符。"""
    if not terms:
        return []
    params: dict[str, Any] = {"pt": playthrough_id, "before": before_seq, "limit": limit}
    matches: list[str] = []
    for i, term in enumerate(terms):
        params[f"t{i}"] = term.lower()
        matches.append(
            f"""(strpos(lower(t.narrative), :t{i}) > 0
                OR strpos(lower(COALESCE(t.user_action->>'text', '')), :t{i}) > 0
                OR strpos(lower(COALESCE(n.digest, '')), :t{i}) > 0)"""
        )
    rows = await fetch_all(
        conn,
        f"""
        SELECT t.seq, t.user_action, t.narrative, n.digest
        FROM turns AS t LEFT JOIN turn_notes AS n ON n.turn_id = t.id
        WHERE t.playthrough_id = :pt AND t.seq < :before AND t.status IN {LIVE}
          AND ({" OR ".join(matches)})
        ORDER BY t.seq DESC LIMIT :limit
        """,
        params,
    )
    return [PastTurnRow.from_row(r) for r in rows]


async def turn_at(conn: AsyncConnection, playthrough_id: str, seq: int) -> PastTurnRow | None:
    row = await fetch_one(
        conn,
        f"""
        SELECT t.seq, t.user_action, t.narrative, n.digest
        FROM turns AS t LEFT JOIN turn_notes AS n ON n.turn_id = t.id
        WHERE t.playthrough_id = :pt AND t.seq = :seq AND t.status IN {LIVE}
        ORDER BY t.created_at DESC LIMIT 1
        """,
        {"pt": playthrough_id, "seq": seq},
    )
    return None if row is None else PastTurnRow.from_row(row)
