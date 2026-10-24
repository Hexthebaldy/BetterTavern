"""TurnStore 的 Postgres 实现：runtime 的热路径通过它读写数据库。

所有提交先对 playthroughs 做带条件的 UPDATE（租约与 timeline_epoch 围栏），成功后才写其他表。
普通回合存为 replied，同一个事务里放一个整理世界状态的任务；下一回合不等它整理完。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.memory.chapters import raw_start
from bettertavern.domain.memory.lightning import raw_start as lightning_raw_start
from bettertavern.domain.memory.outline import outline_from_json, slice_of
from bettertavern.domain.scenario.card import CharacterCard, greeting_narrative
from bettertavern.domain.scenario.setup import ScenarioSetup, greetings_of
from bettertavern.domain.story.language import unnamed_protagonist
from bettertavern.domain.story.mode import is_lightning
from bettertavern.domain.story.turn import PlayerAction, TurnStatus
from bettertavern.domain.world.card_source import CardSource
from bettertavern.domain.world.plan import plan_world
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import (
    EntityView,
    FactView,
    LinkView,
    ThreadView,
    WorldSnapshot,
)
from bettertavern.infra.db.repositories import cards as cards_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import outline as outline_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import world as world_repo
from bettertavern.infra.queue.pg_queue import PgJobQueue
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

from .lightning_jobs import enqueue_lightning
from .memory_store import load_story_memory
from .run_records import insert_run as insert_run_record
from .state_jobs import enqueue_state


async def insert_run(conn: AsyncConnection, header: TurnHeader, run: AgentRunRecord) -> str:
    """写一行 agent_runs，连同它的每一步（agent_steps）。返回这次运行的 id。"""
    return await insert_run_record(
        conn,
        run,
        user_id=header.user_id,
        playthrough_id=header.playthrough_id,
        turn_id=header.turn_id,
    )


async def load_world(conn: AsyncConnection, playthrough_id: str) -> WorldSnapshot:
    entities = await world_repo.load_entities(conn, playthrough_id)
    links = await world_repo.load_links(conn, playthrough_id)
    facts = await world_repo.load_facts(conn, playthrough_id)
    threads = await world_repo.load_open_threads(conn, playthrough_id)
    return WorldSnapshot(
        entities=tuple(
            EntityView(
                id=e.id,
                kind=e.kind,
                name=e.name,
                aliases=e.aliases,
                summary=e.summary,
                data=e.data,
                is_protagonist=e.is_protagonist,
                canon=e.canon,
                first_seq=e.first_seq,
                last_seen_seq=e.last_seen_seq,
            )
            for e in entities
        ),
        links=tuple(LinkView(lk.src_id, lk.rel, lk.dst_id) for lk in links),
        facts=tuple(
            FactView(
                id=f.id,
                text=f.text,
                entity_ids=f.entity_ids,
                visibility=f.visibility,
                known_by=f.known_by,
                created_seq=f.created_seq,
            )
            for f in facts
        ),
        threads=tuple(
            ThreadView(t.id, t.kind, t.text, t.entity_ids, t.opened_seq, t.answer) for t in threads
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
    def __init__(self, engine: AsyncEngine, queue: PgJobQueue | None = None) -> None:
        self._engine = engine
        self._queue = queue or PgJobQueue(engine)

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
            mode=pt.mode,
        )

    async def load_context(self, header: TurnHeader) -> TurnContext:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, header.playthrough_id)
            turn = await story_repo.get_turn(conn, header.turn_id)
            assert pt is not None and turn is not None
            action = PlayerAction.from_json(turn.user_action)
            return await load_turn_context(conn, pt, header, action, up_to_seq=header.seq - 1)

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
            run_id = await insert_run(conn, header, run)
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
        # 结局之后不再整理世界状态，直接 committed；闪电模式没有世界状态 agent，也直接 committed；
        # 其余存为 replied，等世界状态 agent 整理
        status = (
            TurnStatus.COMMITTED
            if outcome.ends_story or is_lightning(header.mode)
            else TurnStatus.REPLIED
        )
        updated = await story_repo.complete_turn(
            conn,
            header.turn_id,
            status=status.value,
            narrative=outcome.narrative,
            options=[o.to_json() for o in outcome.options],
            options_source=outcome.options_source,
            usage=usage,
            state_seq=outcome.state_seq,
            director_run_id=director_run_id,
            director_notes=outcome.director_notes,
        )
        if not updated:
            raise _Stale
        if status is TurnStatus.REPLIED:
            await enqueue_state(conn, self._queue, header.playthrough_id)
        elif is_lightning(header.mode) and not outcome.ends_story:
            # 闪电模式：看原文够不够压成梗概（不到阈值就什么都不做，不调模型）
            await enqueue_lightning(conn, self._queue, header.playthrough_id)
        await story_repo.notify_turn(conn, header.turn_id)

    async def fail_turn(self, header: TurnHeader, failure: TurnFailure) -> bool:
        async with self._engine.begin() as conn:
            # 和提交、清理、删除一样先锁 playthroughs 行再写 turns，否则加锁顺序相反会死锁
            await story_repo.release_lease(conn, header.playthrough_id, header.turn_id)
            changed = await story_repo.fail_turn(
                conn, header.turn_id, narrative=failure.narrative, error=failure.to_json()
            )
            for run in failure.runs:
                await insert_run(conn, header, run)
            if changed:
                await story_repo.notify_turn(conn, header.turn_id)
        return changed

    async def world_build_input(self, header: TurnHeader) -> WorldBuildInput:
        async with self._engine.connect() as conn:
            pt = await story_repo.get_playthrough_by_id(conn, header.playthrough_id)
            assert pt is not None
            cards = await _scenario_cards(conn, pt.user_id, pt.scenario_id)
        protagonist = pt.settings.get("protagonist") or {}
        opening, opening_char = _chosen_greeting(pt.settings.get("opening"), cards)
        return WorldBuildInput(
            card=cards[0][1] if cards else None,
            protagonist_name=str(protagonist.get("name") or unnamed_protagonist(pt.language)),
            protagonist_summary=str(protagonist.get("summary") or ""),
            preferences=Preferences.from_json(pt.settings.get("preferences")),
            cards=tuple(card for _, card in cards),
            opening=opening,
            opening_char=opening_char,
        )

    async def save_world(
        self,
        header: TurnHeader,
        seed: Seed,
        source: str,
        run: AgentRunRecord | None,
        cards: CardSource | None = None,
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
                seed=seed_json(seed, cards),
                seed_source=source,
            )
            if run is not None:
                await insert_run(conn, header, run)
        return count


def seed_json(seed: Seed, cards: CardSource | None) -> dict[str, Any]:
    """playthroughs.seed：开局设定，加上卡的原文快照（cards 键，不是模型输出的一部分）"""
    data: dict[str, Any] = seed.model_dump(mode="json")
    if cards is not None:
        data["cards"] = cards.model_dump(mode="json")
    return data


def cards_of(seed: Any) -> CardSource | None:
    """从 playthroughs.seed 取卡的原文快照；这个功能上线前开局的存档没有"""
    if not isinstance(seed, dict) or not isinstance(seed.get("cards"), dict):
        return None
    return CardSource.model_validate(seed["cards"])


async def _scenario_cards(
    conn: AsyncConnection, user_id: str, scenario_id: str | None
) -> list[tuple[str, CharacterCard]]:
    """剧本里的几张卡（按顺序），读此刻的正式版本（剧本实时引用角色卡）。"""
    if scenario_id is None:
        return []
    scenario = await library_repo.get_scenario(conn, user_id, scenario_id)
    if scenario is None or not scenario.cards:
        return []
    rows = await cards_repo.get_cards(conn, user_id, [c.card_id for c in scenario.cards])
    return [(row.id, CharacterCard.model_validate(row.card)) for row in rows]


def _chosen_greeting(value: Any, cards: list[tuple[str, CharacterCard]]) -> tuple[str, str]:
    """开局时记下的开场白选择 → (开场白原文, 角色名)；选的卡或那一条已经不在了就是空的。"""
    opening = ScenarioSetup.from_json({"opening": value}).opening if value else None
    if opening is None:
        return "", ""
    for card_id, card in cards:
        if card_id == opening.card_id:
            greetings = greetings_of(card)
            if opening.greeting < len(greetings) and greetings[opening.greeting].strip():
                return greetings[opening.greeting], card.name
    return "", ""


async def load_turn_context(
    conn: AsyncConnection,
    pt: story_repo.PlaythroughRow,
    header: TurnHeader,
    action: PlayerAction,
    *,
    up_to_seq: int,
) -> TurnContext:
    """拼导演上下文要用的全部内容：原文到 up_to_seq 为止。导演每回合用它，闪电模式的压缩也用它
    （services/lightning_store.py），两边拼出的开头一字不差，前缀缓存才能命中。"""
    # 原文只取章节摘要覆盖到的回合之后（再加上一章最后两回合），更早的在回顾里；
    # 闪电模式从梗概覆盖到的回合之后开始，不多留（domain/memory/lightning.py）
    start = (
        lightning_raw_start(pt.summarized_seq)
        if is_lightning(pt.mode)
        else raw_start(pt.summarized_seq)
    )
    history = await story_repo.list_chain(conn, pt.id, after_seq=start - 1, up_to_seq=up_to_seq)
    world = await load_world(conn, pt.id)
    memory = await load_story_memory(conn, pt.id, pt.summarized_seq)
    current = await outline_repo.current_outline(conn, pt.id)
    greeting, char = "", ""
    if action.source == "opening" and pt.settings.get("opening"):
        cards = await _scenario_cards(conn, pt.user_id, pt.scenario_id)
        greeting, char = _chosen_greeting(pt.settings.get("opening"), cards)
    outline = outline_from_json(current.content) if current else None
    seed = Seed.model_validate(pt.seed) if pt.seed else None
    protagonist = (pt.settings.get("protagonist") or {}).get("name") or (
        seed.protagonist.name if seed else unnamed_protagonist(pt.language)
    )
    if greeting:
        greeting = greeting_narrative(greeting, user=str(protagonist), char=char)
    return TurnContext(
        header=header,
        action=action,
        protagonist_name=str(protagonist),
        preferences=Preferences.from_json(pt.settings.get("preferences")),
        seed=seed,
        history=tuple(
            HistoryTurn(
                seq=t.seq,
                action=PlayerAction.from_json(t.user_action),
                narrative=t.narrative,
                options=tuple(str(o.get("text") or "") for o in t.options if isinstance(o, dict)),
                director_notes=t.director_notes,
            )
            for t in history
        ),
        world=world,
        state_seq=pt.state_seq,
        memory=memory,
        outline=slice_of(outline) if outline is not None else None,
        opening_greeting=greeting,
        cards=cards_of(pt.seed),
    )
