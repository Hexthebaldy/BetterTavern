"""回合的并发与围栏（真实 Postgres，runner 用可编排的假厂商）：

幂等键并发、生成中再提交、租约过期清理后旧 runner 的结果作废、跨租户访问。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.errors import AppError, NotFound
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.route_inputs import RouteInput
from bettertavern.services.turn_service import ActionInput
from tests.fakes.runtime import ScriptedAdapter, StreamScript, result, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

SEED = {
    "world": {"title": "雨夜", "setting": "灰石镇"},
    "protagonist": {"name": "x", "summary": "信使"},
    "characters": [{"name": "老周", "summary": "掌柜"}],
    "locations": [{"name": "酒馆"}],
    "opening": {"location": "酒馆", "present": ["老周"], "situation": "雨夜"},
}
CARD = {"spec": "chara_card_v2", "data": {"name": "老周", "description": "掌柜"}}


def director(n: int) -> list[str]:
    text_ = f"<narrative>\n第{n}段叙述。\n</narrative>\n<options>\n1. 甲{n}\n2. 乙{n}\n</options>"
    return [text_[i : i + 6] for i in range(0, len(text_), 6)]


@dataclass
class World:
    services: Services
    adapter: ScriptedAdapter
    engine: AsyncEngine
    user_id: str
    playthrough_id: str
    head_id: str


async def finish(services: Services, turn_id: str) -> list[str]:
    stream = services.buffers.get(turn_id)
    assert stream is not None
    names = []
    async for event in stream.subscribe(0):
        names.append(event.event)
    return names


@pytest.fixture
async def world(tmp_path: Path) -> AsyncIterator[World]:
    assert URL is not None
    async with schema_engine(URL, pool_size=10) as engine:
        hub, adapters = scripted_hub("fake")
        secrets = load_secrets(
            master_keys=new_master_key_entry("t1"),
            auth_secret="s" * 40,
            allow_dev_fallback=False,
            data_dir=tmp_path,
        )
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
        names = await finish(services, opening.id)
        assert names[-1] == "turn.completed", names
        try:
            yield World(services, adapter, engine, user.id, pt.id, opening.id)
        finally:
            await services.runners.shutdown(1.0)
            await hub.aclose()


async def test_concurrent_submits_with_one_idempotency_key_create_one_turn(world: World) -> None:
    world.adapter.streams.append(StreamScript(director(1), delay=0.01))
    action = ActionInput(source="option", option_id="o1")

    async def submit() -> tuple[str, bool]:
        turn, created = await world.services.turns.create(
            world.user_id,
            world.playthrough_id,
            parent_turn_id=world.head_id,
            action=action,
            idempotency_key="same-key",
        )
        return turn.id, created

    results = await asyncio.gather(*(submit() for _ in range(5)))
    ids = {turn_id for turn_id, _ in results}
    assert len(ids) == 1
    assert sum(1 for _, created in results if created) == 1
    names = await finish(world.services, ids.pop())
    assert names[-1] == "turn.completed"


async def test_second_submit_while_generating_is_rejected(world: World) -> None:
    world.adapter.streams.append(StreamScript(director(1), delay=0.02))

    async def submit(key: str) -> object:
        try:
            turn, _ = await world.services.turns.create(
                world.user_id,
                world.playthrough_id,
                parent_turn_id=world.head_id,
                action=ActionInput(source="text", text=f"我做了 {key}"),
                idempotency_key=key,
            )
            return turn
        except AppError as exc:
            return exc

    outcomes = await asyncio.gather(submit("a"), submit("b"))
    errors = [o for o in outcomes if isinstance(o, AppError)]
    turns = [o for o in outcomes if not isinstance(o, AppError)]
    assert len(turns) == 1 and len(errors) == 1
    assert errors[0].code == "TURN_IN_PROGRESS"
    assert errors[0].extra["active_turn_id"] == turns[0].id  # type: ignore[attr-defined]
    await finish(world.services, turns[0].id)  # type: ignore[attr-defined]


async def test_expired_lease_is_swept_and_the_late_result_is_dropped(world: World) -> None:
    world.adapter.streams.append(StreamScript(director(1), delay=0.05))
    turn, _ = await world.services.turns.create(
        world.user_id,
        world.playthrough_id,
        parent_turn_id=world.head_id,
        action=ActionInput(source="option", option_id="o2"),
        idempotency_key=None,
    )
    await asyncio.sleep(0.1)
    async with world.engine.begin() as conn:
        await conn.execute(
            text("UPDATE playthroughs SET lease_expires_at = now() - interval '1 second'")
        )
    swept = await world.services.maintenance.sweep_leases()
    assert swept == [turn.id]
    names = await finish(world.services, turn.id)
    assert names[-1] == "turn.failed"
    stored = await world.services.turns.get(world.user_id, turn.id)
    assert stored.status == "failed" and stored.error is not None
    assert stored.error["code"] == "RUNNER_LOST"
    detail = await world.services.playthroughs.get(world.user_id, world.playthrough_id)
    assert detail.playthrough.head_turn_id == world.head_id  # 头部没有被迟到的结果改动
    assert detail.last_failed is not None and detail.last_failed.id == turn.id
    # 失败的尝试不占位：同一个 seq 可以重试
    world.adapter.streams.append(StreamScript(director(2)))
    retry, created = await world.services.turns.create(
        world.user_id,
        world.playthrough_id,
        parent_turn_id=world.head_id,
        action=ActionInput(source="option", option_id="o2"),
        idempotency_key=None,
    )
    assert created and retry.seq == turn.seq and retry.attempt == turn.attempt + 1
    assert (await finish(world.services, retry.id))[-1] == "turn.completed"


async def test_other_users_cannot_see_or_touch(world: World) -> None:
    other, _ = await world.services.auth.register("other@example.com", "another password")
    with pytest.raises(NotFound):
        await world.services.playthroughs.get(other.id, world.playthrough_id)
    with pytest.raises(NotFound):
        await world.services.turns.get(other.id, world.head_id)
    with pytest.raises(NotFound):
        await world.services.turns.create(
            other.id,
            world.playthrough_id,
            parent_turn_id=world.head_id,
            action=ActionInput(source="text", text="我闯进来"),
            idempotency_key=None,
        )
    with pytest.raises(NotFound):
        await world.services.playthroughs.world(other.id, world.playthrough_id, reveal=True)


async def test_stale_parent_and_option_validation(world: World) -> None:
    with pytest.raises(AppError) as bad_option:
        await world.services.turns.create(
            world.user_id,
            world.playthrough_id,
            parent_turn_id=world.head_id,
            action=ActionInput(source="option", option_id="o7"),
            idempotency_key=None,
        )
    assert bad_option.value.code == "OPTION_NOT_FOUND"
    world.adapter.streams.append(StreamScript(director(1)))
    turn, _ = await world.services.turns.create(
        world.user_id,
        world.playthrough_id,
        parent_turn_id=world.head_id,
        action=ActionInput(source="text", text="我坐下"),
        idempotency_key=None,
    )
    await finish(world.services, turn.id)
    with pytest.raises(AppError) as stale:
        await world.services.turns.create(
            world.user_id,
            world.playthrough_id,
            parent_turn_id=world.head_id,
            action=ActionInput(source="text", text="我站起来"),
            idempotency_key=None,
        )
    assert stale.value.code == "STALE_PARENT"
    assert stale.value.extra["head_turn_id"] == turn.id
    history = await world.services.turns.history(
        world.user_id, world.playthrough_id, after_seq=-1, limit=10
    )
    assert [t.seq for t in history] == [0, 1]
    assert history[1].action == {"source": "text", "text": "我坐下"}
