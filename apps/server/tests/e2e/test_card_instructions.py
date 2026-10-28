"""卡作者的指令（F2）端到端：真实 Postgres + 跑在 uvicorn 里的 api。

导入写了系统提示、历史后置指令、角色备注和对话示例的卡 → 开局 → 走一回合：导演的系统提示里有
卡作者的要求和对话示例，最后一条消息里玩家行动后面有提醒；开局以后改卡不影响这一局。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_card_instructions.py
"""

from __future__ import annotations

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

INSTRUCTED = {
    **CARD,
    "data": {
        **CARD["data"],  # type: ignore[dict-item]
        "system_prompt": "{{original}}\n{{char}} 说话带江南口音。",
        "post_history_instructions": "别让 {{char}} 太快信任 {{user}}。",
        "mes_example": "<START>\n{{user}}: 有地图吗？\n{{char}}: 地图？我可没有。",
        "extensions": {"depth_prompt": {"prompt": "{{char}} 嘴硬心软。", "depth": 4}},
    },
}


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def test_the_director_follows_the_card_authors(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        saved: dict[str, Any] = await import_scenario(client, auth, INSTRUCTED)
        card_id = saved["card"]["id"]
        card = (await client.get(f"/v1/cards/{card_id}", headers=auth)).json()["content"]
        assert card["depth_prompt"] == "{{char}} 嘴硬心软。"
        assert card["post_history_instructions"] == "别让 {{char}} 太快信任 {{user}}。"

        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": saved["scenario"]["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        created = r.json()
        playthrough_id = created["playthrough"]["id"]
        await read_events(client, created["events_url"], token)

        detail = (await client.get(f"/v1/playthroughs/{playthrough_id}", headers=auth)).json()
        body = {
            "parent_turn_id": detail["playthrough"]["head_turn_id"],
            "action": {"source": "option", "option_id": "o1"},
        }
        r = await client.post(f"/v1/playthroughs/{playthrough_id}/turns", headers=auth, json=body)
        assert r.status_code == 201, r.text
        await read_events(client, r.json()["events_url"], token)

        request = [q for q in running.fake.app.chat_requests if q.body.get("stream")][-1]
        messages = request.body["messages"]
        system, last = messages[0]["content"], messages[-1]["content"]
        # 普通模式：系统提示里有卡作者的要求（{{original}} 去掉了）和对话示例，名字都换好了
        rules = system[system.index("<card-instructions>\n") : system.index("</card-instructions>")]
        assert "阿苓 说话带江南口音。" in rules and "original" not in rules
        assert "林川: 有地图吗？\n阿苓: 地图？我可没有。" in system
        # 后置指令和角色备注在玩家行动后面
        reminder = last[last.index("<card-reminder>") : last.index("</card-reminder>")]
        assert "别让 阿苓 太快信任 林川。\n\n阿苓 嘴硬心软。" in reminder
        assert last.index("</player-action>") < last.index("<card-reminder>")
        assert all("<card-reminder>" not in m["content"] for m in messages[1:-1])

        # 开局以后改卡：这一局还用开局时的
        r = await client.post(
            "/v1/workbench/drafts", headers=auth, json={"origin": "edit_card", "card_id": card_id}
        )
        assert r.status_code == 201, r.text
        draft = r.json()
        edited = {**draft["card"], "depth_prompt": "改过的角色备注"}
        draft_id = draft["draft"]["id"]
        r = await client.put(
            f"/v1/workbench/drafts/{draft_id}/card",
            headers=auth,
            json={"version": draft["draft"]["version"], "card": edited},
        )
        assert r.status_code == 200, r.text
        r = await client.post(f"/v1/workbench/drafts/{draft_id}/save", headers=auth, json={})
        assert r.status_code == 200, r.text

        detail = (await client.get(f"/v1/playthroughs/{playthrough_id}", headers=auth)).json()
        body["parent_turn_id"] = detail["playthrough"]["head_turn_id"]
        r = await client.post(f"/v1/playthroughs/{playthrough_id}/turns", headers=auth, json=body)
        assert r.status_code == 201, r.text
        await read_events(client, r.json()["events_url"], token)
        request = [q for q in running.fake.app.chat_requests if q.body.get("stream")][-1]
        last = request.body["messages"][-1]["content"]
        assert "阿苓 嘴硬心软。" in last and "改过的角色备注" not in last
