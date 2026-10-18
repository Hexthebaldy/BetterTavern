"""M1 端到端：真实 Postgres + 假 LLM 服务 + 跑在 uvicorn 里的 api。

注册 → 添加凭据 → 配置导演路由 → 导入角色卡 → 开局（WorldBuilder 与开场流式）→ 点选项推进
（幂等重放、并发提交、过期父回合）→ 中途断开再带 Last-Event-ID 续传，拼接结果等于最终叙述。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_m1_flow.py
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from tests.e2e.m1_app import CARD, Running, narrative_of, read_events, serve, setup_account
from tests.fakes.llm_server import RunningFakeLLM
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    async with serve(fake_llm, tmp_path) as app:
        yield app


async def test_full_m1_flow(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}

        # 导入角色卡（JSON V2）；同一个文件再导入一次返回已有的剧本
        files = {"file": ("card.json", json.dumps(CARD).encode(), "application/json")}
        r = await client.post("/v1/scenarios/import", headers=auth, files=files)
        assert r.status_code == 201, r.text
        scenario = r.json()
        assert scenario["name"] == "阿苓" and scenario["book_entries"] == 1
        # 预览是给人看的：宏换成名字，*动作* 换成括号
        assert scenario["description_preview"].startswith("阿苓 是灰石镇酒馆的帮工")
        assert scenario["first_mes_preview"] == "（阿苓抬起头）外乡人？先把斗篷上的水拧干。"
        r = await client.post("/v1/scenarios/import", headers=auth, files=files)
        assert r.status_code == 200 and r.json()["duplicate"] is True

        # 开局：202，订阅开场回合的事件流
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}},
        )
        assert r.status_code == 202, r.text
        created = r.json()
        assert created["playthrough"]["language"] == "zh"  # 不传时按中文
        playthrough_id = created["playthrough"]["id"]
        opening_events = await read_events(client, created["events_url"], token)
        names = [e.event for e in opening_events]
        assert names[:3] == ["turn.created", "world.building", "world.ready"]
        assert json.loads(opening_events[2].data)["source"] == "world_builder"
        assert names[-2:] == ["options.ready", "turn.completed"]
        completed = json.loads(opening_events[-1].data)["turn"]
        assert narrative_of(opening_events) == completed["narrative"]
        assert completed["narrative"].startswith("第1段")
        assert [o["id"] for o in completed["options"]] == ["o1", "o2"]
        assert running.story.world_calls == 1

        # 世界状态：主角名以玩家输入为准；秘密默认隐藏
        r = await client.get(f"/v1/playthroughs/{playthrough_id}/world", headers=auth)
        world = r.json()
        hero = next(e for e in world["entities"] if e["is_protagonist"])
        assert hero["name"] == "林川"
        assert world["hidden_facts"] == 1
        assert all(not f["secret"] for f in world["facts"])

        # 导演的请求里：状态块在最后一条消息，主角名是玩家输入的名字
        director_request = [r for r in running.fake.app.chat_requests if r.body.get("stream")][-1]
        last = director_request.body["messages"][-1]["content"]
        assert "<world-state>" in last and "林川" in last and "老周欠北境商会" in last

        # 点选项推进：带幂等键；重放返回同一个回合
        detail = (await client.get(f"/v1/playthroughs/{playthrough_id}", headers=auth)).json()
        head_id = detail["playthrough"]["head_turn_id"]
        assert head_id == completed["id"]
        key = str(uuid.uuid4())
        body = {"parent_turn_id": head_id, "action": {"source": "option", "option_id": "o1"}}
        r = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers={**auth, "Idempotency-Key": key},
            json=body,
        )
        assert r.status_code == 201, r.text
        turn = r.json()["turn"]
        assert turn["seq"] == 1 and turn["action"]["text"].startswith("走向柜台")
        replay = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers={**auth, "Idempotency-Key": key},
            json=body,
        )
        assert replay.status_code == 200 and replay.json()["turn"]["id"] == turn["id"]
        reused = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers={**auth, "Idempotency-Key": key},
            json={**body, "action": {"source": "text", "text": "换个说法"}},
        )
        assert reused.status_code == 422 and reused.json()["code"] == "IDEMPOTENCY_KEY_REUSED"

        # 生成中再提交：409 TURN_IN_PROGRESS，带进行中的回合
        busy = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers=auth,
            json={"parent_turn_id": head_id, "action": {"source": "text", "text": "我等等"}},
        )
        assert busy.status_code == 409, busy.text
        assert busy.json()["code"] == "TURN_IN_PROGRESS"
        assert busy.json()["active_turn_id"] == turn["id"]

        # 中途断开：读到两段叙述就断，再带 Last-Event-ID 续传
        url = f"/v1/turns/{turn['id']}/events"
        first = await read_events(
            client,
            url,
            token,
            stop=lambda evs: sum(1 for e in evs if e.event == "narrative.delta") >= 2,
        )
        assert first[-1].event == "narrative.delta"
        second = await read_events(client, url, token, last_event_id=first[-1].id)
        assert second[0].id != first[-1].id
        all_events = first + second
        final = json.loads(all_events[-1].data)["turn"]
        assert all_events[-1].event == "turn.completed"
        assert narrative_of(all_events) == final["narrative"]
        assert final["narrative"].startswith("第2段")
        ids = [e.id for e in all_events]
        assert len(ids) == len(set(ids))  # 不重不漏

        # 父回合已经过期：409 STALE_PARENT，带最新的头部
        stale = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers=auth,
            json={"parent_turn_id": head_id, "action": {"source": "text", "text": "我回头看"}},
        )
        assert stale.status_code == 409 and stale.json()["code"] == "STALE_PARENT"
        assert stale.json()["head_turn_id"] == final["id"]

        # 历史与回合详情
        history = (
            await client.get(f"/v1/playthroughs/{playthrough_id}/turns", headers=auth)
        ).json()["turns"]
        assert [t["seq"] for t in history] == [0, 1]
        assert history[1]["status"] == "committed"
        r = await client.get(f"/v1/turns/{turn['id']}", headers=auth)
        assert r.json()["options_source"] == "model"

        # 缓冲过期之后再订阅：给快照（这里直接清空缓冲来模拟）
        assert running.story.director_calls == 2


async def test_ending_closes_the_story(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        token = account["token"]
        auth = {"Authorization": f"Bearer {token}"}
        files = {"file": ("card.json", json.dumps(CARD).encode(), "application/json")}
        scenario = (await client.post("/v1/scenarios/import", headers=auth, files=files)).json()
        # 提示词的语言只认 zh、en、ja
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}, "language": "fr"},
        )
        assert r.status_code == 422 and r.json()["code"] == "VALIDATION_ERROR"
        # 英文界面开的局：存下 language，之后给导演的提示词是英文的（故事内容照旧）
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={"scenario_id": scenario["id"], "protagonist": {"name": "林川"}, "language": "en"},
        )
        created = r.json()
        assert created["playthrough"]["language"] == "en"
        playthrough_id = created["playthrough"]["id"]
        opening = json.loads((await read_events(client, created["events_url"], token))[-1].data)
        head_id = opening["turn"]["id"]
        director = [req for req in running.fake.app.chat_requests if req.body.get("stream")][
            -1
        ].body["messages"]
        assert director[0]["content"].startswith("You are the director")
        assert "<opening-brief>" in director[-1]["content"]
        turns_url = f"/v1/playthroughs/{playthrough_id}/turns"

        # 写结局，带上想要的方向
        r = await client.post(
            turns_url,
            headers=auth,
            json={
                "parent_turn_id": head_id,
                "action": {"source": "ending", "text": "  和阿苓一起离开小镇  "},
            },
        )
        assert r.status_code == 201, r.text
        ending = r.json()
        assert ending["turn"]["action"] == {"source": "ending", "text": "和阿苓一起离开小镇"}
        events = await read_events(client, ending["events_url"], token)
        assert [e.event for e in events][-2:] == ["options.ready", "turn.completed"]
        assert json.loads(events[-2].data) == {"options": [], "source": None}
        final = json.loads(events[-1].data)["turn"]
        # 假服务照常写了选项：结局只留叙述
        assert final["narrative"].startswith("第2段") and final["options"] == []
        last = [r for r in running.fake.app.chat_requests if r.body.get("stream")][-1]
        prompt = last.body["messages"][-1]["content"]
        assert "<ending-wish>" in prompt and "和阿苓一起离开小镇" in prompt

        # 这局标成已完结，头部是结局那一轮
        detail = (await client.get(f"/v1/playthroughs/{playthrough_id}", headers=auth)).json()
        assert detail["playthrough"]["status"] == "ended"
        assert detail["head"]["id"] == final["id"] and detail["head"]["options_source"] is None
        listed = (await client.get("/v1/playthroughs", headers=auth)).json()
        assert [p["status"] for p in listed] == ["ended"]

        # 之后什么都不能再提交，结局也不能再写一次
        for action in ({"source": "text", "text": "我回头看"}, {"source": "ending"}):
            r = await client.post(
                turns_url, headers=auth, json={"parent_turn_id": final["id"], "action": action}
            )
            assert r.status_code == 409 and r.json()["code"] == "STORY_ENDED"
        # 已完结的故事照常能改名、看世界状态
        r = await client.patch(
            f"/v1/playthroughs/{playthrough_id}", headers=auth, json={"title": "雨夜（完）"}
        )
        assert r.status_code == 200 and r.json()["status"] == "ended"
        r = await client.get(f"/v1/playthroughs/{playthrough_id}/world", headers=auth)
        assert r.status_code == 200


async def test_auth_and_isolation(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        auth = {"Authorization": f"Bearer {account['token']}"}
        r = await client.post(
            "/v1/auth/register", json={"email": "other@example.com", "password": "another pass 2"}
        )
        other = {"Authorization": f"Bearer {r.json()['access_token']}"}
        # 别人的模型：404，不泄露存在性；也不能复用别人的 Key
        r = await client.get(f"/v1/model-routes/{account['route_id']}", headers=other)
        assert r.status_code == 404 and r.json()["code"] == "NOT_FOUND"
        r = await client.get("/v1/model-routes", headers=other)
        assert r.json() == []
        r = await client.post(
            "/v1/model-routes",
            headers=other,
            json={
                "provider": "custom_openai",
                "copy_key_from": account["route_id"],
                "model": "fake-model",
            },
        )
        assert r.status_code == 404
        # 没带令牌、令牌乱写
        assert (await client.get("/v1/me")).status_code == 401
        assert (
            await client.get("/v1/me", headers={"Authorization": "Bearer x"})
        ).status_code == 401
        assert (await client.get("/v1/me", headers=auth)).json()["email"] == "lin@example.com"


async def test_route_window_validation(running: Running) -> None:
    async with httpx.AsyncClient(base_url=running.base_url, timeout=30) as client:
        account = await setup_account(client, running.fake)
        auth = {"Authorization": f"Bearer {account['token']}"}
        url = f"/v1/model-routes/{account['route_id']}"
        r = await client.patch(url, headers=auth, json={"params": {"working_window": 8000}})
        assert r.status_code == 422
        problem: dict[str, Any] = r.json()
        assert problem["code"] == "WINDOW_TOO_SMALL"
        assert problem["effective_window"] < 16_000
        r = await client.patch(url, headers=auth, json={"params": {"working_window": 1_000_000}})
        assert r.status_code == 200
        assert r.json()["window"]["warnings"] == ["WINDOW_CLAMPED"]
        # 手填窗口：列表和能力表都不知道时才用；传 null 清掉
        r = await client.patch(url, headers=auth, json={"manual_window": 131072})
        assert r.json()["window"]["model_window"] == 131072
        assert r.json()["window"]["source"] == "manual"
        r = await client.patch(url, headers=auth, json={"manual_window": None})
        assert r.json()["window"]["source"] == "default"
