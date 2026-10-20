"""模型路由（真实 Postgres，假厂商）。

窗口从哪来、复用 Key、一起换 Key、只有一个导演、学到的窗口、跨租户。
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from bettertavern.domain.routing import RouteTask
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ModelInfo, ProviderError
from bettertavern.providers.capabilities import parse_rules
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.errors import AppError, NotFound
from bettertavern.services.route_inputs import RouteInput, RoutePatch
from tests.fakes.runtime import ScriptedAdapter, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

# 能力表只知道 table-* 的窗口
RULES = parse_rules([{"match": {"model": "table-*"}, "caps": {"context_window": 200_000}}])


@dataclass
class Env:
    services: Services
    fake: ScriptedAdapter
    other: ScriptedAdapter
    user_id: str
    stranger_id: str


@pytest.fixture
async def env(tmp_path: Path) -> AsyncIterator[Env]:
    assert URL is not None
    async with schema_engine(URL) as engine:
        hub, adapters = scripted_hub("fake", "other", rules=RULES)
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
            runner_config=RunnerConfig(),
            instance_id="test",
        )
        user, _ = await services.auth.register("lin@example.com", "correct horse")
        stranger, _ = await services.auth.register("zhou@example.com", "another horse")
        try:
            yield Env(services, adapters["fake"], adapters["other"], user.id, stranger.id)
        finally:
            await services.aclose(grace=0)


def new(
    model: str,
    *,
    key: str = "sk-test-aaaa-1111",
    manual_window: int | None = None,
    director: bool = False,
    params: dict[str, Any] | None = None,
    caps_override: dict[str, Any] | None = None,
) -> RouteInput:
    return RouteInput(
        provider="fake",
        model=model,
        api_key=key,
        manual_window=manual_window,
        director=director,
        params=params,
        caps_override=caps_override,
    )


async def test_window_comes_from_list_then_table_then_manual_then_estimate(env: Env) -> None:
    routes = env.services.routes
    env.fake.models = [
        ModelInfo(id="listed", context_window=48_000),
        ModelInfo(id="table-x"),
        ModelInfo(id="plain"),
    ]
    listed = await routes.create(env.user_id, new("listed", manual_window=500_000))
    # 服务商列表最优先，手填的不会盖过它
    assert (listed.window.model_window, listed.window.source) == (48_000, "listed")
    assert listed.status == "ok"
    table = await routes.create(env.user_id, new("table-x"))
    assert (table.window.model_window, table.window.source) == (200_000, "table")
    manual = await routes.create(env.user_id, new("plain", manual_window=65_536))
    assert (manual.window.model_window, manual.window.source) == (65_536, "manual")
    estimate = await routes.create(env.user_id, new("not-in-list"))
    assert (estimate.window.model_window, estimate.window.source) == (32_768, "default")


async def test_saving_reuses_the_list_fetched_by_the_form(env: Env) -> None:
    routes = env.services.routes
    models = await routes.preview_models(
        env.user_id, "fake", api_key="sk-test-aaaa-1111", copy_key_from=None, base_url=None
    )
    assert [(m.id, m.context_window, m.window_source) for m in models] == [
        ("fake-model", 65536, "listed")
    ]
    await routes.create(env.user_id, new("fake-model"))
    assert env.fake.list_calls == 1


async def test_list_failure_does_not_block_saving(env: Env) -> None:
    env.fake.list_error = ProviderError(ErrorClass.SERVER_ERROR, "boom", status=500)
    view = await env.services.routes.create(env.user_id, new("fake-model"))
    assert view.status == "unverified"
    assert view.window.source == "default"


async def test_preview_rejected_key(env: Env) -> None:
    env.fake.list_error = ProviderError(ErrorClass.AUTH, "bad key", status=401)
    with pytest.raises(AppError) as info:
        await env.services.routes.preview_models(
            env.user_id, "fake", api_key="sk-wrong-0000", copy_key_from=None, base_url=None
        )
    assert info.value.code == "CREDENTIAL_INVALID"


async def test_copy_key_and_replace_it_everywhere(env: Env) -> None:
    routes = env.services.routes
    first = await routes.create(env.user_id, new("fake-model"))
    second = await routes.create(
        env.user_id, RouteInput(provider="fake", model="plain", copy_key_from=first.id)
    )
    third = await routes.create(env.user_id, new("plain", key="sk-test-bbbb-2222"))
    assert second.key_last4 == "1111"
    views = {v.id: v for v in await routes.list(env.user_id)}
    assert views[first.id].shares_key_with == [second.id]
    assert views[second.id].shares_key_with == [first.id]
    assert views[third.id].shares_key_with == []

    # 换 Key 时选择把用同一个旧 Key 的模型一起换掉；用别的 Key 的不动
    await routes.update(
        env.user_id, first.id, RoutePatch(api_key="sk-test-cccc-3333", apply_to_same_key=True)
    )
    views = {v.id: v for v in await routes.list(env.user_id)}
    assert views[first.id].key_last4 == views[second.id].key_last4 == "3333"
    assert views[third.id].key_last4 == "2222"
    assert views[first.id].shares_key_with == [second.id]
    resolved = await routes.resolve(env.user_id, RouteTask.DIRECTOR)
    assert resolved is None  # 还没设导演

    with pytest.raises(AppError) as info:
        await routes.create(
            env.user_id, RouteInput(provider="other", model="x", copy_key_from=first.id)
        )
    assert info.value.code == "VALIDATION_ERROR"


async def test_only_one_director_and_everything_uses_it(env: Env) -> None:
    routes = env.services.routes
    a = await routes.create(env.user_id, new("fake-model", director=True))
    b = await routes.create(env.user_id, new("plain"))
    await routes.update(env.user_id, b.id, RoutePatch(director=True))
    views = {v.id: v for v in await routes.list(env.user_id)}
    assert views[a.id].is_director is False and views[b.id].is_director is True
    for task in (RouteTask.DIRECTOR, RouteTask.WORLD_BUILDER, RouteTask.REPAIR):
        resolved = await routes.resolve(env.user_id, task)
        assert resolved is not None and resolved.route_id == b.id and resolved.task is task
    # 删掉导演就没有导演了
    await routes.delete(env.user_id, b.id)
    assert await routes.resolve(env.user_id, RouteTask.DIRECTOR) is None


async def test_learned_window_only_goes_down(env: Env) -> None:
    routes = env.services.routes
    view = await routes.create(env.user_id, new("fake-model", director=True))
    assert view.window.model_window == 65536
    assert await routes.note_window(env.user_id, view.id, 32768) is True
    assert await routes.note_window(env.user_id, view.id, 40000) is False
    learned = await routes.get(env.user_id, view.id)
    assert (learned.window.model_window, learned.window.source) == (32768, "learned")
    resolved = await routes.resolve(env.user_id, RouteTask.DIRECTOR)
    assert resolved is not None and resolved.window.model_window == 32768
    # 换了模型，学到的窗口不再适用
    changed = await routes.update(env.user_id, view.id, RoutePatch(model="table-y"))
    assert changed.window.source == "table"


async def test_new_key_must_be_confirmed_again(env: Env) -> None:
    routes = env.services.routes
    view = await routes.create(env.user_id, new("fake-model"))
    assert view.status == "ok"
    env.fake.list_error = ProviderError(ErrorClass.SERVER_ERROR, "boom", status=500)
    changed = await routes.update(env.user_id, view.id, RoutePatch(api_key="sk-test-dddd-4444"))
    assert changed.status == "unverified" and changed.last_probe is None
    # 列表恢复后重新获取：Key 确认可用，窗口照旧
    env.fake.list_error = None
    await routes.list_models(env.user_id, view.id)
    again = await routes.get(env.user_id, view.id)
    assert again.status == "ok" and again.window.source == "listed"


async def test_window_is_checked_on_save(env: Env) -> None:
    routes = env.services.routes
    with pytest.raises(AppError) as info:
        await routes.create(env.user_id, new("fake-model", params={"working_window": 8000}))
    assert info.value.code == "WINDOW_TOO_SMALL"
    with pytest.raises(AppError) as info:
        await routes.create(env.user_id, new("x", caps_override={"context_window": 9}))
    assert info.value.code == "VALIDATION_ERROR"


async def test_other_users_cannot_see_or_reuse(env: Env) -> None:
    routes = env.services.routes
    mine = await routes.create(env.user_id, new("fake-model", director=True))
    assert await routes.list(env.stranger_id) == []
    with pytest.raises(NotFound):
        await routes.get(env.stranger_id, mine.id)
    with pytest.raises(NotFound):
        await routes.update(env.stranger_id, mine.id, RoutePatch(director=True))
    with pytest.raises(NotFound):
        await routes.create(
            env.stranger_id, RouteInput(provider="fake", model="m", copy_key_from=mine.id)
        )
    assert await routes.note_window(env.stranger_id, mine.id, 20000) is False
    assert await routes.resolve(env.stranger_id, RouteTask.DIRECTOR) is None
