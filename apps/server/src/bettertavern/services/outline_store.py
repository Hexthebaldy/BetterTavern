"""OutlineStore 的 Postgres 实现：大纲修订通过它读待修订的情况、写修订的决定。

写入在一个事务里，先对 playthroughs 做带条件的 UPDATE（修订进度 outline_seq、时间线编号），
成功后才写修订（docs/agent-runtime.md 第 8 节）。
"""

from __future__ import annotations

import dataclasses

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.memory.outline import outline_from_json
from bettertavern.domain.story.language import unnamed_protagonist
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import ThreadView
from bettertavern.infra.db.repositories import outline as outline_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import world as world_repo
from bettertavern.runtime.ports import AgentRunRecord, OutlineCommit, OutlineWork

from .memory_store import load_story_memory
from .run_records import insert_run

# 章节摘要覆盖到的回合之后，最多给多少回合的一句话摘要（一章通常不到 60 回合）
DIGEST_LIMIT = 60


class _Stale(Exception):
    """修订进度或时间线编号对不上：回滚整个事务。"""


class PgOutlineStore:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine

    async def pending(self, playthrough_id: str) -> OutlineWork | None:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, playthrough_id)
            if pt is None or pt.status == "building" or pt.state_seq < 0:
                return None
            current = await outline_repo.current_outline(conn, playthrough_id)
            outline = outline_from_json(current.content) if current else None
            reasons = await outline_repo.pending_reasons(
                conn, playthrough_id, after_seq=pt.outline_seq, up_to_seq=pt.state_seq
            )
            if outline is not None and not reasons:
                return None
            digests = await outline_repo.recent_digests(
                conn,
                playthrough_id,
                after_seq=pt.summarized_seq,
                up_to_seq=pt.state_seq,
                limit=DIGEST_LIMIT,
            )
            memory = await load_story_memory(conn, playthrough_id, pt.summarized_seq)
            threads = await world_repo.load_open_threads(conn, playthrough_id)
            turn_id = await outline_repo.note_turn_id(conn, playthrough_id, pt.state_seq)
        seed = Seed.model_validate(pt.seed) if pt.seed else None
        protagonist = (pt.settings.get("protagonist") or {}).get("name") or (
            seed.protagonist.name if seed else unnamed_protagonist(pt.language)
        )
        return OutlineWork(
            playthrough_id=playthrough_id,
            user_id=pt.user_id,
            epoch=pt.timeline_epoch,
            language=pt.language,
            protagonist_name=str(protagonist),
            outline_seq=pt.outline_seq,
            based_on_seq=pt.state_seq,
            turn_id=turn_id,
            outline=outline,
            reasons=tuple(reasons),
            digests=tuple(digests),
            memory=memory,
            threads=tuple(
                ThreadView(t.id, t.kind, t.text, t.entity_ids, t.opened_seq, t.answer)
                for t in threads
            ),
            seed=seed,
        )

    async def commit(self, work: OutlineWork, result: OutlineCommit) -> bool:
        try:
            async with self._engine.begin() as conn:
                advanced = await outline_repo.advance_outline(
                    conn,
                    work.playthrough_id,
                    from_seq=work.outline_seq,
                    to_seq=work.based_on_seq,
                    epoch=work.epoch,
                )
                if not advanced:
                    raise _Stale
                await outline_repo.insert_revision(
                    conn,
                    work.playthrough_id,
                    based_on_seq=work.based_on_seq,
                    content=result.outline.model_dump(mode="json") if result.outline else None,
                    reason=result.reason,
                )
                await self._insert_run(conn, work, result.run)
        except _Stale:
            await self.fail(work, dataclasses.replace(result.run, status="stale"))
            return False
        return True

    async def fail(self, work: OutlineWork, run: AgentRunRecord) -> None:
        async with self._engine.begin() as conn:
            await self._insert_run(conn, work, run)

    async def _insert_run(
        self, conn: AsyncConnection, work: OutlineWork, run: AgentRunRecord
    ) -> None:
        # 记在依据到的那一回合上，日志查看工具里打开那一回合能看到
        await insert_run(
            conn,
            run,
            user_id=work.user_id,
            playthrough_id=work.playthrough_id,
            turn_id=work.turn_id,
        )
