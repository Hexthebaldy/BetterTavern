"""世界状态 agent 的写入（真实 Postgres，模型用可编排的假厂商）：

回合存为 replied 并放一个整理任务；整理结果在一个事务里写进世界状态、撤销记录和回合标签；
时间线变了的结果作废；失败两次跳过；世界状态接口带上整理进度和问题。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.world.records import RowChange
from bettertavern.infra.crypto.keyring import AppSecrets, load_secrets, new_master_key_entry
from bettertavern.providers import ChatResult, EndpointPolicy, ToolCall, Usage
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.ports import AgentRunRecord, StateCommit
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig
from bettertavern.services.container import Services, build_services, build_state_runner
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.route_inputs import RouteInput
from bettertavern.services.state_store import PgStateStore
from bettertavern.services.turn_service import ActionInput
from tests.fakes.runtime import ScriptedAdapter, StreamScript, result, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

SEED = {
    "world": {"title": "雨夜", "setting": "灰石镇"},
    "protagonist": {"name": "林川", "summary": "信使"},
    "characters": [{"name": "老周", "summary": "掌柜"}],
    "locations": [{"name": "酒馆"}, {"name": "码头"}],
    "opening": {"location": "酒馆", "present": ["老周"], "situation": "雨夜"},
}
CARD = {"spec": "chara_card_v2", "data": {"name": "老周", "description": "掌柜"}}


def director(n: int) -> list[str]:
    body = f"<narrative>\n第{n}段叙述。\n</narrative>\n<options>\n1. 甲{n}\n2. 乙{n}\n</options>"
    return [body[i : i + 6] for i in range(0, len(body), 6)]


def calls(*items: tuple[str, dict[str, Any]]) -> ChatResult:
    return ChatResult(
        text="",
        reasoning="",
        tool_calls=tuple(
            ToolCall(id=f"c{i}", name=name, arguments=json.dumps(args, ensure_ascii=False))
            for i, (name, args) in enumerate(items)
        ),
        finish_reason="tool_calls",
        usage=Usage(prompt=100, completion=20),
    )


def commit(digest: str, *entities: str) -> tuple[str, dict[str, Any]]:
    return ("commit", {"digest": digest, "entities": list(entities), "scene_ended": False})


@dataclass
class Game:
    services: Services
    state: StateRunner
    adapter: ScriptedAdapter
    engine: AsyncEngine
    user_id: str
    playthrough_id: str
    opening_id: str


async def finish(services: Services, turn_id: str) -> None:
    stream = services.buffers.get(turn_id)
    assert stream is not None
    async for _ in stream.subscribe(0):
        pass


def secrets_for(tmp_path: Path) -> AppSecrets:
    return load_secrets(
        master_keys=new_master_key_entry("t1"),
        auth_secret="s" * 40,
        allow_dev_fallback=False,
        data_dir=tmp_path,
    )


@pytest.fixture
async def game(tmp_path: Path) -> AsyncIterator[Game]:
    assert URL is not None
    async with schema_engine(URL, pool_size=10) as engine:
        hub, adapters = scripted_hub("fake")
        secrets = secrets_for(tmp_path)
        services = build_services(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            buffers=EventBufferRegistry(),
            access_ttl_s=900,
            refresh_ttl_s=3600,
            runner_config=RunnerConfig(delta_batch_s=0.0, lease_renew_s=0.2),
            instance_id="test",
        )
        state = build_state_runner(
            engine=engine,
            secrets=secrets,
            hub=hub,
            policy=EndpointPolicy(),
            config=StateRunnerConfig(turn_timeout_s=5.0),
        )
        user, _ = await services.auth.register("lin@example.com", "correct horse")
        await services.routes.create(
            user.id,
            RouteInput(
                provider="fake", model="fake-model", api_key="sk-test-123456", director=True
            ),
        )
        scenario = await services.scenarios.import_file(user.id, json.dumps(CARD).encode())
        adapter = adapters["fake"]
        adapter.completions.append(result(json.dumps(SEED, ensure_ascii=False)))
        adapter.streams.append(StreamScript(director(0)))
        pt, opening = await services.playthroughs.create(
            user.id, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
        )
        await finish(services, opening.id)
        try:
            yield Game(services, state, adapter, engine, user.id, pt.id, opening.id)
        finally:
            await services.runners.shutdown(1.0)
            await hub.aclose()


async def rows(engine: AsyncEngine, sql: str, **params: Any) -> Sequence[Any]:
    async with engine.connect() as conn:
        return (await conn.execute(text(sql), params)).all()


async def play(game: Game, n: int) -> str:
    game.adapter.streams.append(StreamScript(director(n)))
    [(head,)] = await rows(
        game.engine,
        "SELECT head_turn_id::text FROM playthroughs WHERE id = :id",
        id=game.playthrough_id,
    )
    turn, _ = await game.services.turns.create(
        game.user_id,
        game.playthrough_id,
        parent_turn_id=head,
        action=ActionInput(source="option", option_id="o1"),
        idempotency_key=None,
    )
    await finish(game.services, turn.id)
    return turn.id


async def test_turns_are_saved_as_replied_with_one_queued_job(game: Game) -> None:
    [(status, state_seq)] = await rows(
        game.engine,
        """SELECT t.status, p.state_seq FROM turns t JOIN playthroughs p ON p.id = t.playthrough_id
           WHERE t.id = :id""",
        id=game.opening_id,
    )
    assert (status, state_seq) == ("replied", -1)
    await play(game, 1)
    # 第二个回合存好时已经有一个还没开始的任务，不再放新的
    jobs = await rows(game.engine, "SELECT kind, ordering_key, status FROM jobs")
    assert [tuple(j) for j in jobs] == [("state.turn", f"{game.playthrough_id}:state", "pending")]


async def test_state_writes_world_patches_and_notes(game: Game) -> None:
    game.adapter.completions.append(
        calls(
            ("create_entity", {"kind": "item", "name": "铜钥匙", "summary": "生锈"}),
            ("move", {"entity": "铜钥匙", "to": "老周"}),
            ("add_fact", {"text": "老周收下了钥匙", "about": ["老周", "铜钥匙"]}),
            commit("老周收下了一把铜钥匙", "老周", "铜钥匙"),
        )
    )
    assert await game.state.process(game.playthrough_id) == 1

    [(status, state_seq)] = await rows(
        game.engine,
        """SELECT t.status, p.state_seq FROM turns t JOIN playthroughs p ON p.id = t.playthrough_id
           WHERE t.id = :id""",
        id=game.opening_id,
    )
    assert (status, state_seq) == ("committed", 0)
    [(key_id, canon, first_seq)] = await rows(
        game.engine, "SELECT id, canon, first_seq FROM entities WHERE name = '铜钥匙'"
    )
    assert (canon, first_seq) == ("sketch", 0)
    holders = await rows(
        game.engine,
        """SELECT e.name FROM entity_links l JOIN entities e ON e.id = l.dst_id
           WHERE l.src_id = :id AND l.rel = 'held_by'""",
        id=key_id,
    )
    assert [h[0] for h in holders] == ["老周"]
    [(source, created)] = await rows(
        game.engine,
        "SELECT source_turn_id::text, created_seq FROM facts WHERE text = '老周收下了钥匙'",
    )
    assert (source, created) == (game.opening_id, 0)
    patches = await rows(
        game.engine,
        "SELECT idx, target, before IS NULL FROM state_patches WHERE turn_id = :id ORDER BY idx",
        id=game.opening_id,
    )
    assert [p[0] for p in patches] == list(range(len(patches)))
    assert ("link", True) in [(p[1], p[2]) for p in patches]
    [(digest, entity_count, skipped)] = await rows(
        game.engine,
        "SELECT digest, cardinality(entity_ids), skipped FROM turn_notes WHERE turn_id = :id",
        id=game.opening_id,
    )
    assert (digest, entity_count, skipped) == ("老周收下了一把铜钥匙", 2, False)
    [(run_status, steps)] = await rows(
        game.engine,
        """SELECT r.status, (SELECT count(*) FROM agent_steps s WHERE s.run_id = r.id)
           FROM agent_runs r WHERE r.agent = 'state_keeper'""",
    )
    assert (run_status, steps) == ("ok", 5)  # 一次调模型、四次用工具


async def test_world_api_reports_progress_and_problems(game: Game) -> None:
    game.adapter.completions.append(calls(commit("雨夜里我走进了酒馆")))
    await game.state.process(game.playthrough_id)
    await play(game, 1)
    world = await game.services.playthroughs.world(game.user_id, game.playthrough_id, reveal=False)
    assert world.state_seq == 0 and world.state_issue is None

    # 第 1 回合：第一次失败，等下一回合的任务再试
    game.adapter.completions.append(ChatResult("好的", "", (), "stop", None))
    game.adapter.completions.extend([ChatResult("好的", "", (), "stop", None)] * 20)
    await game.state.process(game.playthrough_id)
    world = await game.services.playthroughs.world(game.user_id, game.playthrough_id, reveal=False)
    assert world.state_seq == 0
    assert world.state_issue is not None
    assert (world.state_issue.seq, world.state_issue.kind, world.state_issue.reason) == (
        1,
        "failed",
        "no_commit",
    )

    # 第二次失败：跳过这一回合，整理进度照样前进
    game.adapter.completions.extend([ChatResult("好的", "", (), "stop", None)] * 21)
    await game.state.process(game.playthrough_id)
    world = await game.services.playthroughs.world(game.user_id, game.playthrough_id, reveal=False)
    assert world.state_seq == 1
    assert world.state_issue is not None and world.state_issue.kind == "skipped"
    [(status,)] = await rows(
        game.engine,
        "SELECT status FROM turns WHERE seq = 1 AND playthrough_id = :pt",
        pt=game.playthrough_id,
    )
    assert status == "committed"


async def test_results_are_dropped_when_the_timeline_moved(game: Game) -> None:
    store = PgStateStore(game.engine)
    turn = await store.next_turn(game.playthrough_id)
    assert turn is not None and turn.seq == 0
    # 整理期间发生了回退：时间线编号变了
    async with game.engine.begin() as conn:
        await conn.execute(
            text("UPDATE playthroughs SET timeline_epoch = timeline_epoch + 1 WHERE id = :id"),
            {"id": game.playthrough_id},
        )
    hero = next(e for e in turn.world.entities if e.is_protagonist)
    after = {**hero.to_json(), "last_seen_seq": 0, "rev": hero.rev + 1, "summary": "改过"}
    result = StateCommit(
        changes=(RowChange("entity", hero.to_json(), after),),
        digest="不该写进去",
        entity_ids=(hero.id,),
        scene_ended=False,
        run=AgentRunRecord(agent="state_keeper", task="state_keeper", status="ok"),
    )
    assert await store.commit(turn, result) is False
    [(summary,)] = await rows(
        game.engine, "SELECT summary FROM entities WHERE id = :id", id=hero.id
    )
    assert summary == hero.summary
    assert not await rows(game.engine, "SELECT 1 FROM turn_notes")
    assert not await rows(game.engine, "SELECT 1 FROM state_patches")
    [(run_status,)] = await rows(
        game.engine, "SELECT status FROM agent_runs WHERE agent = 'state_keeper'"
    )
    assert run_status == "stale"
