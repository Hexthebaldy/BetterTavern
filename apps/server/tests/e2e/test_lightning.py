"""闪电模式（docs/agent-runtime.md 的“闪电模式”）：剧本的设置里打开，开局时定下，之后不变。

真的 api + 假模型服务（m1_app），在临时 schema 里跑。
"""

from __future__ import annotations

import itertools
import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests.e2e.m1_app import Running, import_scenario, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def set_lightning(
    client: httpx.AsyncClient, auth: dict[str, str], scenario: dict[str, Any], on: bool
) -> dict[str, Any]:
    setup: dict[str, Any] = {**scenario["setup"], "lightning": on}
    r = await client.patch(
        f"/v1/scenarios/{scenario['id']}",
        headers=auth,
        json={"setup": setup, "version": scenario["version"]},
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_mode_is_taken_from_the_scenario_at_start_and_never_changes(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        saved: dict[str, Any] = await import_scenario(client, auth)
        scenario: dict[str, Any] = saved["scenario"]
        assert scenario["setup"]["lightning"] is False

        scenario = await set_lightning(client, auth, scenario, True)
        assert scenario["setup"]["lightning"] is True
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        created = r.json()
        assert created["playthrough"]["mode"] == "lightning"
        await read_events(client, created["events_url"], token)
        lightning_id = created["playthrough"]["id"]

        # 剧本改回普通：已经开始的这一局还是闪电，新开的是普通
        scenario = await set_lightning(client, auth, scenario, False)
        r = await client.get(f"/v1/playthroughs/{lightning_id}", headers=auth)
        assert r.json()["playthrough"]["mode"] == "lightning"
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        assert r.json()["playthrough"]["mode"] == "standard"
        modes = {
            p["id"]: p["mode"] for p in (await client.get("/v1/playthroughs", headers=auth)).json()
        }
        assert modes[lightning_id] == "lightning"


async def start_lightning(
    client: httpx.AsyncClient, auth: dict[str, str], token: str
) -> tuple[str, dict[str, Any]]:
    saved: dict[str, Any] = await import_scenario(client, auth)
    scenario = await set_lightning(client, auth, saved["scenario"], True)
    r = await client.post(
        "/v1/playthroughs",
        headers=auth,
        json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
    )
    assert r.status_code == 202, r.text
    created = r.json()
    events = await read_events(client, created["events_url"], token)
    opening = json.loads(events[-1].data)["turn"]
    return created["playthrough"]["id"], opening


async def play(
    client: httpx.AsyncClient, auth: dict[str, str], token: str, pt_id: str, head: str
) -> dict[str, Any]:
    r = await client.post(
        f"/v1/playthroughs/{pt_id}/turns",
        headers={**auth, "Idempotency-Key": str(uuid.uuid4())},
        json={"parent_turn_id": head, "action": {"source": "option", "option_id": "o1"}},
    )
    assert r.status_code == 201, r.text
    events = await read_events(client, r.json()["events_url"], token)
    return json.loads(events[-1].data)["turn"]


async def test_a_lightning_turn_is_a_standard_one_without_the_world_state(
    running: Running,
) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        pt_id, opening = await start_lightning(client, auth, token)
        # 开局和普通模式一样请 WorldBuilder 搭世界
        assert running.story.world_calls == 1
        detail = (await client.get(f"/v1/playthroughs/{pt_id}", headers=auth)).json()
        assert detail["playthrough"]["seed_source"] == "world_builder"
        assert opening["status"] == "committed"

        head = opening["id"]
        for _ in range(3):
            turn = await play(client, auth, token, pt_id, head)
            # 没有世界状态 agent：存好就是 committed，不等后台
            assert turn["status"] == "committed"
            head = turn["id"]

        requests = [r.body for r in running.fake.app.chat_requests if r.body.get("stream")]
        assert len(requests) == 4  # 开场加 3 回合，每回合一次请求
        for body in requests:
            # 原文都还在上下文里，没有要查的旧回合：不给工具
            assert "tools" not in body
            system = body["messages"][0]["content"]
            # 隐藏备注和普通模式一样；卡的原文整段在 system 里，宏换成了名字
            assert "<director-notes>" in system and "<card-source>" in system
            assert "阿苓 是灰石镇酒馆的帮工" in system and "雨夜，林川 推门走进" in system
            assert "北境商会的火漆是黑色的" in system and "地图？我可没有" in system
            assert "<world-state>" not in body["messages"][-1]["content"]
        # 后一回合的请求一直到前一回合玩家的行动都一字不差（前缀缓存）
        for prev, nxt in itertools.pairwise(requests[1:]):
            assert nxt["messages"][: len(prev["messages"])] == prev["messages"]
