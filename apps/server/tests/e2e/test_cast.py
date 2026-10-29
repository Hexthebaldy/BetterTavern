"""多角色的局（F4，docs/cast.md）端到端：真实 Postgres + 跑在 uvicorn 里的 api。

两张卡的剧本开局 → 详情里有这一局的角色 → 行动里提到谁谁说话、每段是谁写的跟着回合返回 →
让一个角色先不出场 → 点名旁白、让他们接着说 → 一张卡的剧本不能点名。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_cast.py
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests.e2e.m1_app import CARD, Running, import_scenario, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

ZHOU = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "老周",
        "description": "{{char}} 是灰石酒馆的掌柜，消息灵通。",
        "personality": "慢性子",
        "system_prompt": "{{char}} 说话慢吞吞的。",
    },
}


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def act(
    client: httpx.AsyncClient, auth: dict[str, str], token: str, pt: str, action: dict[str, Any]
) -> tuple[dict[str, Any], list[Any]]:
    detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
    body = {"parent_turn_id": detail["playthrough"]["head_turn_id"], "action": action}
    r = await client.post(f"/v1/playthroughs/{pt}/turns", headers=auth, json=body)
    assert r.status_code == 201, r.text
    events = await read_events(client, r.json()["events_url"], token)
    assert events[-1].event == "turn.completed", events[-1].data
    completed = json.loads(events[-1].data)["turn"]
    turn = (await client.get(f"/v1/turns/{completed['id']}", headers=auth)).json()
    assert turn["segments"] == completed["segments"]
    return turn, events


def last_prompt(running: Running) -> str:
    request = [q for q in running.fake.app.chat_requests if q.body.get("stream")][-1]
    return str(request.body["messages"][-1]["content"])


async def test_each_character_speaks_for_themselves(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        first: dict[str, Any] = await import_scenario(client, auth, CARD)
        second: dict[str, Any] = await import_scenario(client, auth, ZHOU)
        scenario_id = first["scenario"]["id"]
        r = await client.patch(
            f"/v1/scenarios/{scenario_id}",
            headers=auth,
            json={"card_ids": [first["card"]["id"], second["card"]["id"]]},
        )
        assert r.status_code == 200, r.text

        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario_id, "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        pt = r.json()["playthrough"]["id"]
        opening = await read_events(client, r.json()["events_url"], token)
        # 开场照旧由导演写
        assert "speaker.started" not in [e.event for e in opening]

        detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
        assert [(c["position"], c["name"], c["muted"]) for c in detail["cast"]] == [
            (0, "阿苓", False),
            (1, "老周", False),
        ]
        assert detail["head"]["segments"] == []

        # 行动里提到了老周：老周说话，选项在最后补
        turn, events = await act(client, auth, token, pt, {"source": "text", "text": "我问老周"})
        starts = [json.loads(e.data) for e in events if e.event == "speaker.started"]
        assert starts == [{"index": 0, "speaker": 1, "name": "老周"}]
        assert [s["speaker"] for s in turn["segments"]] == [1]
        assert turn["narrative"].startswith("【老周】\n")
        assert [o["text"] for o in turn["options"]] == ["修复的选项一", "修复的选项二"]
        prompt = last_prompt(running)
        assert "说话慢吞吞的" in prompt and "偷偷收集各地的地图" not in prompt
        assert "老周欠北境商会一笔钱" in prompt  # 他自己知道的秘密

        # 老周先不出场：点他的名也不算，在场的阿苓说话
        r = await client.patch(f"/v1/playthroughs/{pt}/cast/1", headers=auth, json={"muted": True})
        assert r.status_code == 200, r.text
        assert [c["muted"] for c in r.json()["cast"]] == [False, True]
        turn, _ = await act(
            client, auth, token, pt, {"source": "text", "text": "大家好", "speakers": [1]}
        )
        assert [s["speaker"] for s in turn["segments"]] == [0]
        assert turn["action"] == {"source": "text", "text": "大家好", "speakers": [1]}
        prompt = last_prompt(running)
        assert "偷偷收集各地的地图" in prompt and "老周欠北境商会一笔钱" not in prompt

        # 点名旁白，再让他们接着说
        turn, _ = await act(
            client, auth, token, pt, {"source": "option", "option_id": "o1", "speakers": [None]}
        )
        assert [s["speaker"] for s in turn["segments"]] == [None]
        assert "这一段是旁白" in last_prompt(running)
        turn, _ = await act(client, auth, token, pt, {"source": "continue"})
        assert turn["action"] == {"source": "continue", "text": ""}
        assert [s["speaker"] for s in turn["segments"]] == [0]

        history = (await client.get(f"/v1/playthroughs/{pt}/turns", headers=auth)).json()
        assert [len(t["segments"]) for t in history["turns"]] == [0, 1, 1, 1, 1]

        detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
        body = {
            "parent_turn_id": detail["playthrough"]["head_turn_id"],
            "action": {"source": "text", "text": "嗯", "speakers": [5]},
        }
        r = await client.post(f"/v1/playthroughs/{pt}/turns", headers=auth, json=body)
        assert r.status_code == 422, r.text
        r = await client.patch(f"/v1/playthroughs/{pt}/cast/7", headers=auth, json={"muted": True})
        assert r.status_code == 404, r.text


async def test_a_story_with_one_card_has_no_cast(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        saved: dict[str, Any] = await import_scenario(client, auth, CARD)
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": saved["scenario"]["id"], "protagonist": {"name": "林川"}},
        )
        pt = r.json()["playthrough"]["id"]
        await read_events(client, r.json()["events_url"], token)
        detail = (await client.get(f"/v1/playthroughs/{pt}", headers=auth)).json()
        assert detail["cast"] == []
        for action in ({"source": "continue"}, {"source": "text", "text": "嗯", "speakers": [0]}):
            body = {"parent_turn_id": detail["playthrough"]["head_turn_id"], "action": action}
            r = await client.post(f"/v1/playthroughs/{pt}/turns", headers=auth, json=body)
            assert r.status_code == 422, r.text
        turn, events = await act(client, auth, token, pt, {"source": "text", "text": "你好"})
        assert turn["segments"] == [] and "speaker.started" not in [e.event for e in events]
