"""TurnStore 的 Postgres 实现：runtime 的热路径通过它读写数据库。

所有提交先对 playthroughs 做带条件的 UPDATE（租约与 timeline_epoch 围栏），成功后才写其他表。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.turn import PlayerAction, TurnStatus
from bettertavern.domain.world.plan import plan_world
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import EntityView, FactView, LinkView, WorldSnapshot
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import runs as runs_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import world as world_repo
from bettertavern.runtime.ports import (
    AgentRunRecord,
    HistoryTurn,
    Preferences,
    TurnContext,
    TurnFailure,
    TurnHeader,
    TurnOutcome,
    WorldBuildInput,
)


def run_insert(header: TurnHeader, run: AgentRunRecord) -> runs_repo.AgentRunInsert:
    usage = run.usage
    return runs_repo.AgentRunInsert(
        user_id=header.user_id,
        playthrough_id=header.playthrough_id,
        turn_id=header.turn_id,
        agent=run.agent,
        task=run.task,
        status=run.status,
        provider=run.provider,
        model=run.model,
        prompt_hash=run.prompt_hash,
        input_tokens=usage.prompt if usage else None,
        cached_tokens=usage.cached if usage else None,
        output_tokens=usage.completion if usage else None,
        reasoning_tokens=usage.reasoning if usage else None,
        ttft_ms=run.ttft_ms,
        latency_ms=run.latency_ms,
        error_class=run.error_class,
        result=dict(run.result),
    )


async def load_world(conn: AsyncConnection, playthrough_id: str) -> WorldSnapshot:
    entities = await world_repo.load_entities(conn, playthrough_id)
    links = await world_repo.load_links(conn, playthrough_id)
    facts = await world_repo.load_facts(conn, playthrough_id)
    return WorldSnapshot(
        entities=tuple(
            EntityView(
                id=e.id,
                kind=e.kind,
                name=e.name,
                aliases=e.aliases,
                summary=e.summary,
                data=e.data,
                importance=e.importance,
                is_protagonist=e.is_protagonist,
                canon=e.canon,
            )
            for e in entities
        ),
        links=tuple(LinkView(lk.src_id, lk.rel, lk.dst_id) for lk in links),
        facts=tuple(
            FactView(
                id=f.id,
                text=f.text,
                entity_ids=f.entity_ids,
                importance=f.importance,
                visibility=f.visibility,
                known_by=f.known_by,
            )
            for f in facts
        ),
    )


async def write_seed(conn: AsyncConnection, playthrough_id: str, seed: Seed) -> int:
    """在调用方的事务里写入开局世界。返回实体数量。"""
    plan = plan_world(seed)
    ids: dict[str, str] = {}
    for draft in plan.entities:
        ids[draft.key] = await world_repo.insert_entity(
            conn,
            playthrough_id=playthrough_id,
            kind=draft.kind,
            name=draft.name,
            name_norm=draft.name_norm,
            aliases=draft.aliases,
            summary=draft.summary,
            data=draft.data,
            importance=draft.importance,
            is_protagonist=draft.is_protagonist,
        )
    for link in plan.links:
        await world_repo.insert_link(
            conn,
            playthrough_id=playthrough_id,
            src_id=ids[link.src],
            rel=link.rel,
            dst_id=ids[link.dst],
        )
    for fact in plan.facts:
        await world_repo.insert_fact(
            conn,
            playthrough_id=playthrough_id,
            text=fact.text,
            entity_ids=[ids[k] for k in fact.entities],
            importance=fact.importance,
            visibility="secret" if fact.secret else "public",
            known_by=[ids[k] for k in fact.known_by],
        )
    world_draft = next(d for d in plan.entities if d.key == plan.world_key)
    data = dict(world_draft.data)
    data["scene"] = {
        "location": ids.get(plan.scene_location) if plan.scene_location else None,
        "present": [ids[k] for k in plan.scene_present],
        "goal": seed.protagonist.goal,
    }
    await world_repo.update_entity_data(conn, ids[plan.world_key], data)
    return len(plan.entities)


class _Stale(Exception):
    """围栏不满足：回滚整个事务。"""


class PgTurnStore:
    def __init__(
        self,
        engine: AsyncEngine,
        *,
        poll_interval: float = 0.2,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._engine = engine
        self._poll = poll_interval
        self._clock = clock

    async def load_header(self, turn_id: str) -> TurnHeader | None:
        async with self._engine.connect() as conn:
            turn = await story_repo.get_turn(conn, turn_id)
            if turn is None:
                return None
            pt = await story_repo.get_playthrough_by_id(conn, turn.playthrough_id)
        if pt is None:
            return None
        return TurnHeader(
            turn_id=turn.id,
            playthrough_id=pt.id,
            user_id=pt.user_id,
            seq=turn.seq,
            attempt=turn.attempt,
            epoch=turn.timeline_epoch,
            status=turn.status,
            world_ready=pt.status != "building",
            language=pt.language,
        )

    async def load_context(self, header: TurnHeader) -> TurnContext:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, header.playthrough_id)
            turn = await story_repo.get_turn(conn, header.turn_id)
            assert pt is not None and turn is not None
            history = await story_repo.list_chain(
                conn, header.playthrough_id, up_to_seq=header.seq - 1
            )
            world = await load_world(conn, header.playthrough_id)
        seed = Seed.model_validate(pt.seed) if pt.seed else None
        protagonist = (pt.settings.get("protagonist") or {}).get("name") or (
            seed.protagonist.name if seed else "我"
        )
        return TurnContext(
            header=header,
            action=PlayerAction.from_json(turn.user_action),
            protagonist_name=str(protagonist),
            preferences=Preferences.from_json(pt.settings.get("preferences")),
            seed=seed,
            history=tuple(
                HistoryTurn(
                    seq=t.seq, action=PlayerAction.from_json(t.user_action), narrative=t.narrative
                )
                for t in history
            ),
            world=world,
        )

    async def _parent_status(self, header: TurnHeader) -> str | None:
        async with self._engine.connect() as conn:
            turn = await story_repo.get_turn(conn, header.turn_id)
            if turn is None or turn.parent_turn_id is None:
                return TurnStatus.COMMITTED.value
            parent = await story_repo.get_turn(conn, turn.parent_turn_id)
        return parent.status if parent is not None else TurnStatus.COMMITTED.value

    async def wait_parent_committed(self, header: TurnHeader, timeout: float) -> bool:
        deadline = self._clock() + timeout
        delay = self._poll
        while True:
            status = await self._parent_status(header)
            # 父回合被归档（发生了回退）也放行：这一轮的提交会被围栏挡住
            if status in (TurnStatus.COMMITTED.value, TurnStatus.ARCHIVED.value, None):
                return True
            remaining = deadline - self._clock()
            if remaining <= 0:
                return False
            await asyncio.sleep(min(delay, remaining))
            delay = min(delay * 1.5, 1.0)

    async def renew_lease(self, header: TurnHeader, ttl_s: float) -> bool:
        async with self._engine.begin() as conn:
            return await story_repo.renew_lease(
                conn, header.playthrough_id, header.turn_id, epoch=header.epoch, ttl_s=ttl_s
            )

    async def commit_turn(self, header: TurnHeader, outcome: TurnOutcome) -> bool:
        try:
            async with self._engine.begin() as conn:
                await self._commit(conn, header, outcome)
        except _Stale:
            return False
        return True

    async def _commit(
        self, conn: AsyncConnection, header: TurnHeader, outcome: TurnOutcome
    ) -> None:
        advanced = await story_repo.release_lease_and_advance_head(
            conn, header.playthrough_id, header.turn_id, epoch=header.epoch, end=outcome.ends_story
        )
        if not advanced:
            raise _Stale
        director_run_id: str | None = None
        for run in outcome.runs:
            run_id = await runs_repo.insert_agent_run(conn, run_insert(header, run))
            if run.agent == "director":
                director_run_id = run_id
        usage: dict[str, Any] | None = None
        if outcome.usage is not None:
            usage = {
                "prompt": outcome.usage.prompt,
                "completion": outcome.usage.completion,
                "cached": outcome.usage.cached,
                "reasoning": outcome.usage.reasoning,
            }
        updated = await story_repo.complete_turn(
            conn,
            header.turn_id,
            # M1 没有 state 车道：直接 committed。
            # M2 接入 StateKeeper 后改为 replied，并在同一事务里入队 post_turn
            status=TurnStatus.COMMITTED.value,
            narrative=outcome.narrative,
            options=[o.to_json() for o in outcome.options],
            options_source=outcome.options_source,
            usage=usage,
            state_lag=outcome.state_lag,
            director_run_id=director_run_id,
        )
        if not updated:
            raise _Stale
        await story_repo.notify_turn(conn, header.turn_id)

    async def fail_turn(self, header: TurnHeader, failure: TurnFailure) -> bool:
        async with self._engine.begin() as conn:
            # 和提交、清理、删除一样先锁 playthroughs 行再写 turns，否则加锁顺序相反会死锁
            await story_repo.release_lease(conn, header.playthrough_id, header.turn_id)
            changed = await story_repo.fail_turn(
                conn, header.turn_id, narrative=failure.narrative, error=failure.to_json()
            )
            for run in failure.runs:
                await runs_repo.insert_agent_run(conn, run_insert(header, run))
            if changed:
                await story_repo.notify_turn(conn, header.turn_id)
        return changed

    async def world_build_input(self, header: TurnHeader) -> WorldBuildInput:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, header.playthrough_id)
            assert pt is not None
            card: CharacterCard | None = None
            if pt.scenario_id is not None:
                scenario = await library_repo.get_scenario(conn, pt.user_id, pt.scenario_id)
                if scenario is not None:
                    card = CharacterCard.model_validate(scenario.card)
        protagonist = pt.settings.get("protagonist") or {}
        return WorldBuildInput(
            card=card,
            protagonist_name=str(protagonist.get("name") or "我"),
            protagonist_summary=str(protagonist.get("summary") or ""),
            preferences=Preferences.from_json(pt.settings.get("preferences")),
        )

    async def save_world(
        self, header: TurnHeader, seed: Seed, source: str, run: AgentRunRecord | None
    ) -> int:
        async with self._engine.begin() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, header.playthrough_id, lock=True)
            assert pt is not None
            if pt.status != "building":  # 已经建好（例如重试开场时）
                return await world_repo.count_entities(conn, header.playthrough_id)
            count = await write_seed(conn, header.playthrough_id, seed)
            await story_repo.set_world_built(
                conn,
                header.playthrough_id,
                seed=seed.model_dump(mode="json"),
                seed_source=source,
            )
            if run is not None:
                await runs_repo.insert_agent_run(conn, run_insert(header, run))
        return count
