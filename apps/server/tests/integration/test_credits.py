"""官方模型与点数（真实 Postgres，假厂商）。

体验额度每个邮箱只送一次；只有官方模型扣点；点数用完、全站预算用完时不能开始生成；
官方模型那一行不能改连接；运营方换模型时跟着换；服务器没有官方模型时什么都不做。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.billing import TokenPrices
from bettertavern.domain.routing import RouteTask
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, Secret
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.prompts import PromptBook
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.credits import CreditPolicy
from bettertavern.services.errors import AppError
from bettertavern.services.platform import PlatformModel
from bettertavern.services.playthrough_service import NewPlaythrough
from bettertavern.services.route_inputs import RouteInput, RoutePatch
from bettertavern.services.turn_service import ActionInput
from tests.fakes.runtime import ScriptedAdapter, StreamScript, result, scripted_hub
from tests.support.game import CARD, SEED, director, finish
from tests.support.library import import_scenario
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

# 元 / 百万 token，也就是微元 / token
PRICES = TokenPrices(input=2.0, cached=0.04, output=8.0)
TRIAL_MICRO = 1500 * 1000
PASSWORD = "correct horse"


@dataclass
class Env:
    services: Services
    adapter: ScriptedAdapter
    engine: AsyncEngine


@asynccontextmanager
async def make_env(
    tmp_path: Path, *, platform: bool = True, policy: CreditPolicy | None = None
) -> AsyncIterator[Env]:
    assert URL is not None
    async with schema_engine(URL, pool_size=10) as engine:
        hub, adapters = scripted_hub("fake")
        secrets = load_secrets(
            master_keys=new_master_key_entry("t1"),
            auth_secret="s" * 40,
            allow_dev_fallback=False,
            data_dir=tmp_path,
        )
        model = PlatformModel(
            provider="fake", model="fake-model", api_key=Secret("sk-platform-0000"), prices=PRICES
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
            prompts=PromptBook(),
            platform=model if platform else None,
            credit_policy=policy,
        )
        try:
            yield Env(services, adapters["fake"], engine)
        finally:
            await services.aclose(grace=1.0)


@pytest.fixture
async def env(tmp_path: Path) -> AsyncIterator[Env]:
    async with make_env(tmp_path) as e:
        yield e


async def rows(engine: AsyncEngine, sql: str, **params: Any) -> list[Any]:
    async with engine.connect() as conn:
        return list((await conn.execute(text(sql), params)).all())


async def set_balance(engine: AsyncEngine, user_id: str, micro: int) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE users SET credit_micro = :m WHERE id = :u"), {"m": micro, "u": user_id}
        )


async def register(env: Env, email: str = "lin@example.com") -> str:
    user, _ = await env.services.auth.register(email, PASSWORD)
    return user.id


async def start_story(env: Env, user_id: str) -> tuple[str, str]:
    """导入卡、开局并等开场写完。返回 (游玩 id, 开场回合 id)。"""
    scenario = await import_scenario(env.services, user_id, json.dumps(CARD).encode())
    env.adapter.completions.append(result(json.dumps(SEED, ensure_ascii=False)))
    env.adapter.streams.append(StreamScript(director(0)))
    pt, opening = await env.services.playthroughs.create(
        user_id, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
    )
    await finish(env.services, opening.id)
    return pt.id, opening.id


async def next_turn(env: Env, user_id: str, playthrough_id: str, parent: str, n: int) -> str:
    env.adapter.streams.append(StreamScript(director(n)))
    turn, _ = await env.services.turns.create(
        user_id,
        playthrough_id,
        parent_turn_id=parent,
        action=ActionInput(source="option", option_id="o1"),
        idempotency_key=None,
    )
    await finish(env.services, turn.id)
    return turn.id


def own_key(*, director: bool = True) -> RouteInput:
    return RouteInput(
        provider="fake", model="fake-model", api_key="sk-test-123456", director=director
    )


async def test_new_user_gets_the_official_model_and_one_trial_per_email(env: Env) -> None:
    user_id = await register(env)
    [route] = await env.services.routes.list(user_id)
    assert (route.source, route.is_director, route.key_last4) == ("platform", True, "")
    view = await env.services.credits.view(user_id)
    assert (view.balance, view.platform, view.uses_platform) == (1500, True, True)
    assert view.turns_left == 1500 // view.turn_points
    ledger = await rows(
        env.engine, "SELECT kind, amount_micro FROM credit_ledger WHERE user_id = :u", u=user_id
    )
    assert ledger == [("trial", TRIAL_MICRO)]

    # 删号以后用同一个邮箱（大小写不同也算同一个）重新注册：照样有官方模型，但不再送
    await env.services.auth.delete_account(user_id, PASSWORD)
    again = await register(env, "LIN@Example.com")
    [route] = await env.services.routes.list(again)
    assert route.source == "platform"
    assert (await env.services.credits.view(again)).balance == 0

    # 别的邮箱照常送
    other = await register(env, "zhou@example.com")
    assert (await env.services.credits.view(other)).balance == 1500


async def test_only_the_official_model_is_charged(env: Env) -> None:
    user_id = await register(env)
    pt, opening = await start_story(env, user_id)
    charges = await rows(
        env.engine,
        """SELECT l.agent, l.amount_micro, l.balance_micro, r.user_id::text
           FROM credit_ledger AS l JOIN agent_runs AS r ON r.id = l.run_id
           WHERE l.user_id = :u AND l.kind = 'charge' ORDER BY l.created_at""",
        u=user_id,
    )
    # 搭建世界 10 + 5 token，导演 100 + 50 token
    assert [(agent, amount) for agent, amount, _, _ in charges] == [
        ("world_builder", -(10 * 2 + 5 * 8)),
        ("director", -(100 * 2 + 50 * 8)),
    ]
    assert all(owner == user_id for *_, owner in charges)
    [(balance,)] = await rows(env.engine, "SELECT credit_micro FROM users WHERE id = :u", u=user_id)
    assert balance == TRIAL_MICRO - 60 - 600 == charges[-1][2]

    # 换成自己的 Key 以后不扣
    await env.services.routes.create(user_id, own_key())
    assert not (await env.services.credits.view(user_id)).uses_platform
    await next_turn(env, user_id, pt, opening, 1)
    [(count,)] = await rows(env.engine, "SELECT count(*) FROM credit_ledger WHERE kind = 'charge'")
    assert count == 2


async def test_running_out_of_credits_blocks_new_generation(env: Env) -> None:
    user_id = await register(env)
    pt, opening = await start_story(env, user_id)
    await set_balance(env.engine, user_id, 0)

    with pytest.raises(AppError) as exc:
        await next_turn(env, user_id, pt, opening, 1)
    assert (exc.value.code, exc.value.status) == ("CREDITS_EXHAUSTED", 402)
    [scenario] = await env.services.scenarios.list(user_id)
    with pytest.raises(AppError) as exc:
        await env.services.playthroughs.create(
            user_id, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
        )
    assert exc.value.code == "CREDITS_EXHAUSTED"
    with pytest.raises(AppError) as exc:
        await env.services.workbench.start(user_id, text="做一张卡", language="zh")
    assert exc.value.code == "CREDITS_EXHAUSTED"
    assert await env.services.drafts.list(user_id) == []

    # 欠费的用户换成自己的 Key 照样能玩
    await set_balance(env.engine, user_id, -5000)
    await env.services.routes.create(user_id, own_key())
    await next_turn(env, user_id, pt, opening, 1)


async def test_daily_budget_pauses_the_official_model_for_everyone(tmp_path: Path) -> None:
    async with make_env(tmp_path, policy=CreditPolicy(daily_budget_micro=600)) as env:
        spender = await register(env)
        await start_story(env, spender)  # 花掉 660 微元，超过预算
        other = await register(env, "zhou@example.com")
        scenario = await import_scenario(env.services, other, json.dumps(CARD).encode())
        with pytest.raises(AppError) as exc:
            await env.services.playthroughs.create(
                other, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
            )
        assert (exc.value.code, exc.value.status, exc.value.retryable) == (
            "PLATFORM_BUSY",
            503,
            True,
        )
        # 用自己 Key 的不受影响
        await env.services.routes.create(other, own_key())
        env.adapter.completions.append(result(json.dumps(SEED, ensure_ascii=False)))
        env.adapter.streams.append(StreamScript(director(0)))
        _, opening = await env.services.playthroughs.create(
            other, NewPlaythrough(scenario_id=scenario.id, protagonist_name="林川")
        )
        await finish(env.services, opening.id)


async def test_official_model_connection_cannot_be_changed(env: Env) -> None:
    routes = env.services.routes
    user_id = await register(env)
    [route] = await routes.list(user_id)

    for patch in (
        RoutePatch(model="other-model"),
        RoutePatch(api_key="sk-mine-9999"),
        RoutePatch(base_url="https://example.com/v1"),
        RoutePatch(manual_window=64_000),
    ):
        with pytest.raises(AppError) as exc:
            await routes.update(user_id, route.id, patch)
        assert (exc.value.code, exc.value.status) == ("PLATFORM_ROUTE_FIXED", 409)
    with pytest.raises(AppError) as exc:
        await routes.probe(user_id, route.id)
    assert exc.value.code == "PLATFORM_ROUTE_FIXED"
    with pytest.raises(AppError) as exc:
        await routes.list_models(user_id, route.id)
    assert exc.value.code == "PLATFORM_ROUTE_FIXED"
    with pytest.raises(AppError) as exc:
        await routes.create(
            user_id, RouteInput(provider="fake", model="fake-model", copy_key_from=route.id)
        )
    assert exc.value.code == "VALIDATION_ERROR"

    # 名字和写法设置可以改
    renamed = await routes.update(
        user_id, route.id, RoutePatch(label="官方", params={"temperature": 1.1})
    )
    assert (renamed.label, renamed.params["temperature"]) == ("官方", 1.1)

    # 删了可以加回来，余额不变，没有导演时它当导演
    await routes.delete(user_id, route.id)
    assert await routes.resolve(user_id, RouteTask.DIRECTOR) is None
    back = await routes.ensure_platform(user_id)
    assert back is not None
    assert (back.source, back.is_director) == ("platform", True)
    assert await routes.ensure_platform(user_id) == back
    assert len(await routes.list(user_id)) == 1
    assert (await env.services.credits.view(user_id)).balance == 1500


async def test_official_model_rows_follow_the_operators_model(env: Env) -> None:
    user_id = await register(env)
    async with env.engine.begin() as conn:
        await conn.execute(
            text("UPDATE model_routes SET model = 'old-model', learned_window = 50000")
        )
    assert await env.services.routes.sync_platform() == 1
    [route] = await env.services.routes.list(user_id)
    assert route.model == "fake-model"
    assert route.window.source != "learned"
    assert await env.services.routes.sync_platform() == 0


async def test_without_an_official_model_nothing_changes(tmp_path: Path) -> None:
    async with make_env(tmp_path, platform=False) as env:
        user_id = await register(env)
        assert await env.services.routes.list(user_id) == []
        assert await env.services.routes.ensure_platform(user_id) is None
        view = await env.services.credits.view(user_id)
        assert (view.balance, view.platform, view.uses_platform) == (0, False, False)
        # 自己的 Key 照常用，余额是 0 也不拦
        await env.services.routes.create(user_id, own_key())
        await start_story(env, user_id)
        assert await rows(env.engine, "SELECT 1 FROM credit_ledger") == []
