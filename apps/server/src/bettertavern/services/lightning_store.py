"""LightningStore 的 Postgres 实现：闪电模式的压缩通过它读材料、写新一版梗概
（docs/agent-runtime.md 的“闪电模式”）。

材料和导演每回合的上下文用同一个函数拼（services/turn_store.py 的 load_turn_context），
按“下一回合”拼，原文到头部回合为止：压缩请求的开头因此和导演的请求一字不差。
写入在一个事务里，先对 playthroughs 做带条件的 UPDATE（梗概的覆盖进度 summarized_seq、
时间线编号），成功后才写梗概（docs/agent-runtime.md 第 8 节）。
"""

from __future__ import annotations

import dataclasses

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.story.mode import is_lightning
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.infra.db.repositories import memory as memory_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.runtime.ports import (
    AgentRunRecord,
    CompressCommit,
    CompressWork,
    TurnHeader,
)

from .run_records import insert_run
from .turn_store import load_turn_context


class _Stale(Exception):
    """覆盖进度或时间线编号对不上：回滚整个事务。"""


class PgLightningStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def pending(self, playthrough_id: str) -> CompressWork | None:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, playthrough_id)
            # 结局之后不再有新回合，不用压；开局还没写完时也没有可压的
            if pt is None or not is_lightning(pt.mode) or pt.status != "active":
                return None
            head = await story_repo.get_turn(conn, pt.head_turn_id) if pt.head_turn_id else None
            if head is None:
                return None
            header = TurnHeader(
                turn_id=head.id,
                playthrough_id=pt.id,
                user_id=pt.user_id,
                seq=head.seq + 1,
                attempt=0,
                epoch=pt.timeline_epoch,
                status="",
                world_ready=True,
                language=pt.language,
                mode=pt.mode,
            )
            context = await load_turn_context(
                conn, pt, header, PlayerAction("text", ""), up_to_seq=head.seq
            )
            turns = await story_repo.list_chain(
                conn, pt.id, after_seq=pt.summarized_seq, up_to_seq=head.seq
            )
        return CompressWork(
            playthrough_id=pt.id,
            user_id=pt.user_id,
            epoch=pt.timeline_epoch,
            context=context,
            turn_ids={t.seq: t.id for t in turns},
        )

    async def commit(self, work: CompressWork, result: CompressCommit) -> bool:
        try:
            async with self._engine.begin() as conn:
                advanced = await memory_repo.advance_summarized(
                    conn,
                    work.playthrough_id,
                    first_seq=result.first_seq,
                    last_seq=result.last_seq,
                    epoch=work.epoch,
                )
                if not advanced:
                    raise _Stale
                await memory_repo.insert_summary(
                    conn,
                    work.playthrough_id,
                    kind=memory_repo.SYNOPSIS,
                    first_seq=0,
                    last_seq=result.last_seq,
                    written_seq=result.last_seq,
                    text=result.synopsis,
                )
                await self._insert_run(conn, work, result.run, result.last_seq)
        except _Stale:
            await self.fail(work, dataclasses.replace(result.run, status="stale"))
            return False
        return True

    async def fail(self, work: CompressWork, run: AgentRunRecord) -> None:
        last_seq = run.result.get("last_seq")
        async with self._engine.begin() as conn:
            await self._insert_run(conn, work, run, last_seq if isinstance(last_seq, int) else None)

    async def _insert_run(
        self, conn: AsyncConnection, work: CompressWork, run: AgentRunRecord, last_seq: int | None
    ) -> None:
        # 记在压进梗概的最后一回合上，日志查看工具里打开那一回合能看到
        turn_id = work.turn_ids.get(last_seq) if last_seq is not None else None
        await insert_run(
            conn, run, user_id=work.user_id, playthrough_id=work.playthrough_id, turn_id=turn_id
        )
