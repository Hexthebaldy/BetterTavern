"""StateStore 的 Postgres 实现：世界状态 agent 通过它读要整理的回合、写整理结果。

写入都在一个事务里，并且先对 playthroughs 做带条件的 UPDATE（整理进度 state_seq、时间线编号），
成功后才写世界状态表、撤销记录和回合标签（docs/agent-runtime.md 第 8 节）；同一个事务里往
memory 队列放一个章节整理任务，由它看够不够切一章（services/memory_jobs.py）；还没有大纲、
或者有还没处理的“大纲要改”的原因时，再放一个大纲修订任务（services/outline_jobs.py）。
"""

from __future__ import annotations

import dataclasses

import structlog
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.memory.outline import outline_from_json
from bettertavern.domain.story.turn import PlayerAction, TurnStatus
from bettertavern.infra.db.repositories import outline as outline_repo
from bettertavern.infra.db.repositories import state as state_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.runtime.ports import AgentRunRecord, StateCommit, StateTurn

from .memory_jobs import enqueue_memory
from .outline_jobs import enqueue_outline
from .run_records import insert_run

log = structlog.get_logger(__name__)

RECENT_NOTES = 3


class _Stale(Exception):
    """整理进度或时间线编号对不上：回滚整个事务。"""


class PgStateStore:
    def __init__(self, engine: AsyncEngine, queue: PgJobQueue | None = None) -> None:
        self._engine = engine
        self._queue = queue or PgJobQueue(engine)

    async def next_turn(self, playthrough_id: str) -> StateTurn | None:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, playthrough_id)
            if pt is None or pt.status == "building":
                return None
            chain = await story_repo.list_chain(
                conn, playthrough_id, after_seq=pt.state_seq, limit=1
            )
            if not chain:
                return None
            turn = chain[0]
            # 下一回合是结局（直接 committed，不用整理），或者链断了：没有可整理的
            if turn.seq != pt.state_seq + 1 or turn.status != TurnStatus.REPLIED.value:
                return None
            world = await state_repo.load_records(conn, playthrough_id)
            notes = await state_repo.recent_notes(
                conn, playthrough_id, before_seq=turn.seq, limit=RECENT_NOTES
            )
            scene_start = await state_repo.scene_start(conn, playthrough_id, before_seq=turn.seq)
            failures = await state_repo.failure_count(conn, turn.id)
            current = await outline_repo.current_outline(conn, playthrough_id)
            # 修订在后台、和这里并行：上一回合说过要改，这时可能还没改完，不让它再说一遍
            pending = await outline_repo.pending_reasons(
                conn, playthrough_id, after_seq=pt.outline_seq, up_to_seq=turn.seq - 1
            )
        outline = outline_from_json(current.content) if current is not None else None
        beat = next((b for b in outline.beats if b.status == "active"), None) if outline else None
        return StateTurn(
            turn_id=turn.id,
            playthrough_id=playthrough_id,
            user_id=pt.user_id,
            seq=turn.seq,
            epoch=pt.timeline_epoch,
            language=pt.language,
            action=PlayerAction.from_json(turn.user_action),
            narrative=turn.narrative,
            recent=tuple((n.seq, n.digest) for n in notes if n.digest),
            scene_start=scene_start,
            world=world,
            failures=failures,
            director_notes=turn.director_notes,
            beat=beat,
            outline_pending=tuple(pending) if outline is not None else (),
            outline_seq=pt.outline_seq,
        )

    async def commit(self, turn: StateTurn, result: StateCommit) -> bool:
        try:
            async with self._engine.begin() as conn:
                await self._advance(conn, turn)
                await state_repo.apply_changes(conn, turn.playthrough_id, result.changes)
                await state_repo.insert_patches(
                    conn,
                    playthrough_id=turn.playthrough_id,
                    turn_id=turn.turn_id,
                    seq=turn.seq,
                    changes=result.changes,
                )
                await state_repo.insert_note(
                    conn,
                    turn_id=turn.turn_id,
                    playthrough_id=turn.playthrough_id,
                    seq=turn.seq,
                    digest=result.digest,
                    entity_ids=result.entity_ids,
                    scene_ended=result.scene_ended,
                    outline_reason=result.outline_reason,
                )
                await state_repo.mark_committed(conn, turn.turn_id)
                await self._insert_run(conn, turn, result.run)
                await enqueue_memory(conn, self._queue, turn.playthrough_id)
                await self._maybe_revise(conn, turn)
        except _Stale:
            await self._record(turn, dataclasses.replace(result.run, status="stale"))
            return False
        except IntegrityError:
            # 检查漏掉的冲突（例如名字重复）：这次算失败，失败次数用完后这一回合会被跳过
            log.warning("state.write_conflict", seq=turn.seq, exc_info=True)
            failed = dataclasses.replace(result.run, status="failed", error_class="write_conflict")
            await self._record(turn, failed)
            return False
        return True

    async def fail(self, turn: StateTurn, run: AgentRunRecord) -> None:
        await self._record(turn, run)

    async def skip(self, turn: StateTurn, run: AgentRunRecord) -> bool:
        try:
            async with self._engine.begin() as conn:
                await self._advance(conn, turn)
                await state_repo.insert_note(
                    conn,
                    turn_id=turn.turn_id,
                    playthrough_id=turn.playthrough_id,
                    seq=turn.seq,
                    digest="",
                    entity_ids=(),
                    scene_ended=False,
                    skipped=True,
                )
                await state_repo.mark_committed(conn, turn.turn_id)
                await self._insert_run(conn, turn, run)
                await enqueue_memory(conn, self._queue, turn.playthrough_id)
                await self._maybe_revise(conn, turn)
        except _Stale:
            await self._record(turn, dataclasses.replace(run, status="stale"))
            return False
        return True

    async def _maybe_revise(self, conn: AsyncConnection, turn: StateTurn) -> None:
        """还没有大纲（第一版在后台写），或者有还没处理的“大纲要改”的原因：放一个大纲修订任务。"""
        pending = turn.outline_seq < 0 or await outline_repo.has_pending(
            conn, turn.playthrough_id, after_seq=turn.outline_seq
        )
        if pending:
            await enqueue_outline(conn, self._queue, turn.playthrough_id)

    async def _advance(self, conn: AsyncConnection, turn: StateTurn) -> None:
        advanced = await state_repo.advance_state_seq(
            conn, turn.playthrough_id, seq=turn.seq, epoch=turn.epoch
        )
        if not advanced:
            raise _Stale

    async def _record(self, turn: StateTurn, run: AgentRunRecord) -> None:
        async with self._engine.begin() as conn:
            await self._insert_run(conn, turn, run)

    async def _insert_run(
        self, conn: AsyncConnection, turn: StateTurn, run: AgentRunRecord
    ) -> None:
        await insert_run(
            conn,
            run,
            user_id=turn.user_id,
            playthrough_id=turn.playthrough_id,
            turn_id=turn.turn_id,
        )
