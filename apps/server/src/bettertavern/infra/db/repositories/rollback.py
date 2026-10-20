"""回退到第 K 回合（docs/agent-runtime.md 第 8 节）：撤销 K 之后的世界状态修改、
删掉 K 之后的回合标签、归档 K 之后的回合、把存档的头部指回 K。
调用方在同一个事务里、先锁住 playthroughs 行再调用这些函数。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.domain.world.records import RowChange
from bettertavern.infra.db.sqlutil import as_json, execute, fetch_all


async def patches_after(conn: AsyncConnection, playthrough_id: str, seq: int) -> list[RowChange]:
    """seq 之后各回合的撤销记录，按回合倒序、项倒序：照这个顺序写回改之前的样子。"""
    rows = await fetch_all(
        conn,
        """
        SELECT target, before, after FROM state_patches
        WHERE playthrough_id = :pt AND seq > :seq
        ORDER BY seq DESC, idx DESC
        """,
        {"pt": playthrough_id, "seq": seq},
    )
    return [RowChange(r["target"], as_json(r["before"]), as_json(r["after"])) for r in rows]


def inverted(changes: list[RowChange]) -> list[RowChange]:
    """撤销用的改动：把每一行改回 before（before 为空就删掉这一行）。"""
    return [RowChange(c.target, c.after, c.before) for c in changes]


async def delete_after(conn: AsyncConnection, playthrough_id: str, seq: int) -> tuple[int, int]:
    """删掉 seq 之后的撤销记录和回合标签，返回（撤销记录条数，回合标签条数）。"""
    patches = await execute(
        conn,
        "DELETE FROM state_patches WHERE playthrough_id = :pt AND seq > :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    notes = await execute(
        conn,
        "DELETE FROM turn_notes WHERE playthrough_id = :pt AND seq > :seq",
        {"pt": playthrough_id, "seq": seq},
    )
    return patches, notes


async def archive_after(
    conn: AsyncConnection, playthrough_id: str, seq: int, rollback_id: str
) -> int:
    """seq 之后的回合（包括失败的尝试）标为 archived，共用一个回退批次号。返回归档了几个。"""
    return await execute(
        conn,
        """
        UPDATE turns SET status = 'archived', rollback_id = CAST(:rid AS uuid)
        WHERE playthrough_id = :pt AND seq > :seq
          AND status IN ('replied', 'committed', 'failed')
        """,
        {"pt": playthrough_id, "seq": seq, "rid": rollback_id},
    )


async def move_head(conn: AsyncConnection, playthrough_id: str, turn_id: str, seq: int) -> None:
    """头部指回 turn_id；时间线编号加 1（之前开始的后台整理写入时都会作废）；整理进度不超过 seq；
    回退次数加 1；写完了结局的故事回到进行中。"""
    await execute(
        conn,
        """
        UPDATE playthroughs
        SET head_turn_id = :turn, timeline_epoch = timeline_epoch + 1,
            state_seq = LEAST(state_seq, :seq), rollbacks_used = rollbacks_used + 1,
            status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
            updated_at = now()
        WHERE id = :pt
        """,
        {"pt": playthrough_id, "turn": turn_id, "seq": seq},
    )
