"""保存角色卡前的内容检查（真实 Postgres，假厂商）。

官方服务（content_policy="sfw"）上：没问题的照常存；有色情内容的不存；检查出错时不放过；
检查用官方模型，不扣用户的点数。自己部署的（"open"）不检查。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest

from bettertavern.domain.billing import TokenPrices
from bettertavern.infra.crypto.keyring import load_secrets, new_master_key_entry
from bettertavern.providers import EndpointPolicy, ProviderError, Secret
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.prompts import ContentPolicy, PromptBook
from bettertavern.runtime.runner import RunnerConfig
from bettertavern.services.container import Services, build_services
from bettertavern.services.errors import AppError
from bettertavern.services.platform import PlatformModel
from tests.fakes.runtime import ScriptedAdapter, result, scripted_hub
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

CARD = {
    "spec": "chara_card_v2",
    "data": {"name": "老周", "description": "灰石镇酒馆的掌柜", "first_mes": "雨下得正大。"},
}


@dataclass
class Env:
    services: Services
    adapter: ScriptedAdapter
    user_id: str


@asynccontextmanager
async def make_env(tmp_path: Path, policy: ContentPolicy) -> AsyncIterator[Env]:
    assert URL is not None
    async with schema_engine(URL) as engine:
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
            runner_config=RunnerConfig(),
            instance_id="test",
            prompts=PromptBook(content_policy=policy),
            platform=PlatformModel(
                provider="fake",
                model="fake-model",
                api_key=Secret("sk-platform-0000"),
                prices=TokenPrices(input=2.0, cached=0.04, output=8.0),
            ),
        )
        user, _ = await services.auth.register("lin@example.com", "correct horse")
        try:
            yield Env(services, adapters["fake"], user.id)
        finally:
            await services.aclose(grace=0)


async def draft_id(env: Env) -> str:
    imported = await env.services.drafts.import_file(
        env.user_id, json.dumps(CARD).encode(), language="zh", allow_duplicate=False
    )
    assert imported.draft is not None
    return imported.draft.summary.id


def verdict(*, sexual: bool = False, minors: bool = False) -> str:
    return json.dumps({"sexual": sexual, "minors": minors, "reason": ""})


async def test_clean_card_is_saved_without_charging_the_user(tmp_path: Path) -> None:
    async with make_env(tmp_path, "sfw") as env:
        draft = await draft_id(env)
        env.adapter.completions.append(result(verdict()))
        saved = await env.services.drafts.save(env.user_id, draft)
        assert saved.card.id
        # 卡的文字放进围栏交给模型检查
        [request] = env.adapter.requests
        assert "灰石镇酒馆的掌柜" in request.messages[-1].content
        assert (await env.services.credits.view(env.user_id)).balance == 1500


@pytest.mark.parametrize(
    ("flags", "reasons"),
    [
        ({"sexual": True}, ["sexual"]),
        ({"sexual": True, "minors": True}, ["sexual", "minors"]),
    ],
)
async def test_card_with_sexual_content_is_not_saved(
    tmp_path: Path, flags: dict[str, bool], reasons: list[str]
) -> None:
    async with make_env(tmp_path, "sfw") as env:
        draft = await draft_id(env)
        env.adapter.completions.append(result(verdict(**flags)))
        with pytest.raises(AppError) as exc:
            await env.services.drafts.save(env.user_id, draft)
        assert (exc.value.code, exc.value.status) == ("CONTENT_REJECTED", 422)
        assert exc.value.extra["reasons"] == reasons
        assert await env.services.cards.list(env.user_id) == []


async def test_failed_check_does_not_let_the_card_through(tmp_path: Path) -> None:
    async with make_env(tmp_path, "sfw") as env:
        draft = await draft_id(env)
        env.adapter.completions.append(ProviderError(ErrorClass.AUTH, "bad key", status=401))
        with pytest.raises(AppError) as exc:
            await env.services.drafts.save(env.user_id, draft)
        assert (exc.value.code, exc.value.status, exc.value.retryable) == (
            "CONTENT_CHECK_UNAVAILABLE",
            503,
            True,
        )
        assert await env.services.cards.list(env.user_id) == []


async def test_self_hosted_servers_do_not_check(tmp_path: Path) -> None:
    async with make_env(tmp_path, "open") as env:
        draft = await draft_id(env)
        saved = await env.services.drafts.save(env.user_id, draft)
        assert saved.card.id
        assert env.adapter.requests == []
