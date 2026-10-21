"""MemoryStore 的 Postgres 实现：章节整理通过它读待整理的回合和现有的记忆、写整理结果。

写入在一个事务里，先对 playthroughs 做带条件的 UPDATE（章节摘要的覆盖进度 summarized_seq、
时间线编号），成功后才写章节摘要、全书梗概和玩家画像（docs/agent-runtime.md 第 8 节）。
"""

from __future__ import annotations

import dataclasses

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.story.language import unnamed_protagonist
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.infra.db.repositories import memory as memory_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.runtime.ports import (
    AgentRunRecord,
    ChapterCommit,
    ChapterSummary,
    ChapterTurn,
    MemoryWork,
    StoryMemory,
)

from .run_records import insert_run


class _Stale(Exception):
    """覆盖进度或时间线编号对不上：回滚整个事务。"""


async def load_story_memory(
    conn: AsyncConnection, playthrough_id: str, summarized_seq: int
) -> StoryMemory:
    rows = await memory_repo.load_memory(conn, playthrough_id)
    return StoryMemory(
        synopsis=rows.synopsis.text if rows.synopsis else "",
        synopsis_last_seq=rows.synopsis.last_seq if rows.synopsis else -1,
        chapters=tuple(ChapterSummary(c.first_seq, c.last_seq, c.text) for c in rows.chapters),
        profile=rows.profile,
        summarized_seq=summarized_seq,
    )


class PgMemoryStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def pending(self, playthrough_id: str) -> MemoryWork | None:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, playthrough_id)
            if pt is None or pt.status == "building":
                return None
            turns = await memory_repo.chapter_turns(
                conn, playthrough_id, after_seq=pt.summarized_seq, up_to_seq=pt.state_seq
            )
            if not turns:
                return None
            memory = await load_story_memory(conn, playthrough_id, pt.summarized_seq)
        protagonist = (pt.settings.get("protagonist") or {}).get("name") or (
            (pt.seed or {}).get("protagonist", {}).get("name") or unnamed_protagonist(pt.language)
        )
        return MemoryWork(
            playthrough_id=playthrough_id,
            user_id=pt.user_id,
            epoch=pt.timeline_epoch,
            language=pt.language,
            protagonist_name=str(protagonist),
            turns=tuple(
                ChapterTurn(
                    turn_id=t.turn_id,
                    seq=t.seq,
                    action=PlayerAction.from_json(t.user_action),
                    narrative=t.narrative,
                    scene_ended=t.scene_ended,
                )
                for t in turns
            ),
            memory=memory,
        )

    async def commit(self, work: MemoryWork, result: ChapterCommit) -> bool:
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
                    kind=memory_repo.CHAPTER,
                    first_seq=result.first_seq,
                    last_seq=result.last_seq,
                    written_seq=result.last_seq,
                    text=result.chapter,
                )
                if result.synopsis is not None and result.synopsis_last_seq is not None:
                    await memory_repo.insert_summary(
                        conn,
                        work.playthrough_id,
                        kind=memory_repo.SYNOPSIS,
                        first_seq=0,
                        last_seq=result.synopsis_last_seq,
                        written_seq=result.last_seq,
                        text=result.synopsis,
                    )
                await memory_repo.insert_profile(
                    conn, work.playthrough_id, text=result.profile, based_on_seq=result.last_seq
                )
                await self._insert_run(conn, work, result.run, result.last_seq)
        except _Stale:
            await self.fail(work, dataclasses.replace(result.run, status="stale"))
            return False
        return True

    async def fail(self, work: MemoryWork, run: AgentRunRecord) -> None:
        last_seq = run.result.get("last_seq")
        async with self._engine.begin() as conn:
            await self._insert_run(conn, work, run, last_seq if isinstance(last_seq, int) else None)

    async def _insert_run(
        self, conn: AsyncConnection, work: MemoryWork, run: AgentRunRecord, last_seq: int | None
    ) -> None:
        # 记在这一章最后一回合上，日志查看工具里打开那一回合能看到
        turn_id = next((t.turn_id for t in work.turns if t.seq == last_seq), None)
        await insert_run(
            conn, run, user_id=work.user_id, playthrough_id=work.playthrough_id, turn_id=turn_id
        )
