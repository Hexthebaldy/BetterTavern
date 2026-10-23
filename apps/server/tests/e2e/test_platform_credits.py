"""官方模型：新用户不配 Key 直接玩，按用量扣点数。

真实 Postgres + 跑在 uvicorn 里的 api + 假模型服务。

注册以后就有官方模型（导演）和体验额度；保存角色卡不审核内容；开局用运营方的 Key，扣点数；
官方模型不能改连接，删了可以加回来。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_platform_credits.py
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from tests.e2e.m1_app import Running, import_scenario, read_events, serve
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

PLATFORM_KEY = "sk-platform-test-0000"


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(
        fake_llm,
        tmp_path,
        content_policy="sfw",
        platform_api_key=SecretStr(PLATFORM_KEY),
        platform_provider="custom_openai",
        platform_model="fake-model",
        platform_base_url=fake_llm.base_url,
    ) as app:
        yield app


async def test_new_user_plays_on_the_official_model(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        r = await client.post(
            "/v1/auth/register", json={"email": "lin@example.com", "password": "correct horse 1"}
        )
        assert r.status_code == 201, r.text
        token = r.json()["access_token"]
        auth = {"Authorization": f"Bearer {token}"}

        # 不用配 Key：已经有官方模型，是导演
        r = await client.get("/v1/model-routes", headers=auth)
        [route] = r.json()
        assert (route["source"], route["is_director"], route["key_last4"]) == (
            "platform",
            True,
            "",
        )
        r = await client.get("/v1/me/credits", headers=auth)
        assert r.status_code == 200, r.text
        credits = r.json()
        assert (credits["balance"], credits["platform"], credits["uses_platform"]) == (
            1500,
            True,
            True,
        )
        assert credits["turns_left"] == 1500 // credits["turn_points"]

        # 保存角色卡（不审核内容），再开局
        saved = await import_scenario(client, auth)
        scenario = saved["scenario"]
        assert isinstance(scenario, dict)
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        events = await read_events(client, r.json()["events_url"], token)
        assert events[-1].event == "turn.completed"

        # 调模型用的是运营方的 Key
        calls = running.fake.app.chat_requests
        assert calls
        assert {q.headers.get("authorization") for q in calls} == {f"Bearer {PLATFORM_KEY}"}
        r = await client.get("/v1/me/credits", headers=auth)
        assert 0 < r.json()["balance"] < 1500

        # 连接不能改；删了可以加回来，还是导演
        r = await client.patch(
            f"/v1/model-routes/{route['id']}", headers=auth, json={"model": "other-model"}
        )
        assert (r.status_code, r.json()["code"]) == (409, "PLATFORM_ROUTE_FIXED")
        r = await client.post(f"/v1/model-routes/{route['id']}/probe", headers=auth)
        assert (r.status_code, r.json()["code"]) == (409, "PLATFORM_ROUTE_FIXED")
        r = await client.delete(f"/v1/model-routes/{route['id']}", headers=auth)
        assert r.status_code == 204
        r = await client.post("/v1/model-routes/platform", headers=auth)
        assert r.status_code == 200, r.text
        assert (r.json()["source"], r.json()["is_director"]) == ("platform", True)
        r = await client.get("/v1/me/credits", headers=auth)
        assert r.json()["uses_platform"] is True


async def test_server_without_official_model(fake_llm: RunningFakeLLM, tmp_path: Path) -> None:
    async with (
        serve(fake_llm, tmp_path) as app,
        httpx.AsyncClient(base_url=app.base_url, timeout=30) as client,
    ):
        r = await client.post(
            "/v1/auth/register", json={"email": "lin@example.com", "password": "correct horse 1"}
        )
        auth = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert (await client.get("/v1/model-routes", headers=auth)).json() == []
        r = await client.get("/v1/me/credits", headers=auth)
        assert (r.json()["platform"], r.json()["balance"]) == (False, 0)
        r = await client.post("/v1/model-routes/platform", headers=auth)
        assert (r.status_code, r.json()["code"]) == (503, "PLATFORM_UNAVAILABLE")
