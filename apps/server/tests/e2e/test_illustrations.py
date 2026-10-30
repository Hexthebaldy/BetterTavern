"""故事配图（F5，docs/illustrations.md）端到端：真实 Postgres + 跑在 uvicorn 里的 api，
后台任务在测试里直接跑（和 worker 用同一份配置、同一个 schema）。

没配出图服务时不能画 → 配上以后点“画这一幕” → 同一回合不能同时画两张 → 后台写画面描述、出图、
存成 WebP → 回合和详情里带着图、记下画风 → 重画换掉旧的 → 删掉 → 删一局时图片一起删。
写画面描述和出图都是假服务（tests/e2e/m1_app.py 的 Story）。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_illustrations.py
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest

from bettertavern.entrypoints.bootstrap import (
    app_secrets,
    endpoint_policy,
    prompt_book,
    provider_hub,
)
from bettertavern.providers.transport import build_http_client
from bettertavern.runtime.illustration_runner import IllustrationRunner
from bettertavern.services.container import build_illustration_runner
from tests.e2e.m1_app import Running, import_scenario, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url, engine_for

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


@asynccontextmanager
async def illustration_runner(app: Running) -> AsyncIterator[IllustrationRunner]:
    """worker 里的那个配图任务：同一份配置（解得开 api 存的 Key）、同一个临时 schema。"""
    settings = app.settings
    url = database_url()
    assert settings is not None and url is not None
    engine = engine_for(url, app.schema)
    policy = endpoint_policy(settings)
    hub = provider_hub(settings, policy)
    http = build_http_client(policy)
    try:
        yield build_illustration_runner(
            engine=engine,
            secrets=app_secrets(settings),
            hub=hub,
            policy=policy,
            http=http,
            prompts=prompt_book(settings),
        )
    finally:
        await http.aclose()
        await hub.aclose()
        await engine.dispose()


async def draw(
    client: httpx.AsyncClient, auth: dict[str, str], turn_id: str, body: dict[str, Any]
) -> httpx.Response:
    return await client.post(f"/v1/turns/{turn_id}/images", headers=auth, json=body)


async def test_draw_redraw_and_delete(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        saved: dict[str, Any] = await import_scenario(client, auth)
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={
                "scenario_id": saved["scenario"]["id"],
                "protagonist": {"name": "林川", "summary": "披着灰色斗篷的信使"},
            },
        )
        assert r.status_code == 202, r.text
        pt = r.json()["playthrough"]["id"]
        await read_events(client, r.json()["events_url"], token)
        detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
        head = detail["head"]
        assert head["images"] == [] and detail["playthrough"]["image_style"] == ""

        # 还没配出图服务
        r = await draw(client, auth, head["id"], {})
        assert r.status_code == 409 and r.json()["code"] == "TOOL_ROUTE_MISSING"
        r = await client.post(
            "/v1/tool-routes",
            headers=auth,
            json={
                "kind": "image",
                "provider": "openai_images",
                "label": "本地假出图",
                "api_key": "sk-image-0000-wxyz",
                "base_url": running.fake.base_url,
                "model": "fake-image",
            },
        )
        assert r.status_code == 201, r.text

        r = await draw(client, auth, head["id"], {"request": "阿苓擦杯子", "style": "anime"})
        assert r.status_code == 202, r.text
        first = r.json()
        assert first["status"] == "pending" and first["blob_id"] is None
        assert (first["request"], first["style"]) == ("阿苓擦杯子", "anime")
        # 同一回合同时只画一张
        r = await draw(client, auth, head["id"], {})
        assert r.status_code == 409 and r.json()["code"] == "IMAGE_PENDING"

        async with illustration_runner(running) as runner:
            assert await runner.process(first["id"]) is True

        image = (await client.get(f"/v1/turn-images/{first['id']}", headers=auth)).json()
        assert image["status"] == "ready" and image["error"] is None
        assert (image["width"], image["height"]) == (1536, 1024)
        assert (
            image["prompt"] == "A girl wiping cups in a dim tavern.\n\nStyle: anime illustration."
        )
        r = await client.get(f"/v1/blobs/{image['blob_id']}", headers=auth)
        assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
        # 写画面描述时看到了这一回合、玩家想看的和主角的样子
        scene_request = next(
            q
            for q in running.fake.app.chat_requests
            if "文生图模型" in str(q.body["messages"][-1]["content"])
        )
        prompt = str(scene_request.body["messages"][-1]["content"])
        assert "阿苓擦杯子" in prompt and "披着灰色斗篷的信使" in prompt
        assert head["narrative"].strip()[:20] in prompt
        assert running.story.image_calls == ["/v1/images/generations"]  # 卡没有封面，不带参考图

        detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
        assert detail["playthrough"]["image_style"] == "anime"
        assert [i["id"] for i in detail["head"]["images"]] == [first["id"]]
        history = (await client.get(f"/v1/playthroughs/{pt}/turns", headers=auth)).json()
        assert [i["status"] for i in history["turns"][0]["images"]] == ["ready"]

        # 重画：不带画风就用这一局记下的；画好以后旧的那张连同图片一起删掉
        r = await draw(client, auth, head["id"], {})
        assert r.status_code == 202 and r.json()["style"] == "anime"
        second = r.json()
        turn = (await client.get(f"/v1/turns/{head['id']}", headers=auth)).json()
        assert [i["status"] for i in turn["images"]] == ["ready", "pending"]
        async with illustration_runner(running) as runner:
            assert await runner.process(second["id"]) is True
        turn = (await client.get(f"/v1/turns/{head['id']}", headers=auth)).json()
        assert [i["id"] for i in turn["images"]] == [second["id"]]
        r = await client.get(f"/v1/turn-images/{first['id']}", headers=auth)
        assert r.status_code == 404
        r = await client.get(f"/v1/blobs/{image['blob_id']}", headers=auth)
        assert r.status_code == 404

        # 删掉
        newest = (await client.get(f"/v1/turn-images/{second['id']}", headers=auth)).json()
        r = await client.delete(f"/v1/turn-images/{second['id']}", headers=auth)
        assert r.status_code == 204
        turn = (await client.get(f"/v1/turns/{head['id']}", headers=auth)).json()
        assert turn["images"] == []
        r = await client.get(f"/v1/blobs/{newest['blob_id']}", headers=auth)
        assert r.status_code == 404

        # 删一局：配图的图片一起删掉
        r = await draw(client, auth, head["id"], {"style": ""})
        third = r.json()
        async with illustration_runner(running) as runner:
            assert await runner.process(third["id"]) is True
        third = (await client.get(f"/v1/turn-images/{third['id']}", headers=auth)).json()
        assert third["prompt"] == "A girl wiping cups in a dim tavern."  # 不指定画风
        r = await client.delete(f"/v1/playthroughs/{pt}", headers=auth)
        assert r.status_code == 204
        r = await client.get(f"/v1/blobs/{third['blob_id']}", headers=auth)
        assert r.status_code == 404

        # 别的东西
        r = await draw(client, auth, "00000000-0000-0000-0000-000000000000", {})
        assert r.status_code == 404
        r = await draw(client, auth, head["id"], {"style": "cyberpunk"})
        assert r.status_code == 422
