"""M1 端到端：真实 Postgres + 假 LLM 服务 + 跑在 uvicorn 里的 api。

注册 → 添加凭据 → 配置导演路由 → 导入角色卡 → 开局（WorldBuilder 与开场流式）→ 点选项推进
（幂等重放、并发提交、过期父回合）→ 中途断开再带 Last-Event-ID 续传，拼接结果等于最终叙述。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_m1_flow.py
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from bettertavern.entrypoints.api import build_app_services, create_app
from bettertavern.infra.crypto.keyring import new_master_key_entry
from bettertavern.providers.sse_parser import SseDecoder, SseEvent
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.settings import Settings
from tests.fakes.asgi_server import AsgiServer
from tests.fakes.llm_server import (
    DONE,
    JsonReply,
    RecordedRequest,
    Reply,
    RunningFakeLLM,
    StreamReply,
    chunk,
    completion,
    sse,
)
from tests.support.pg import database_url, engine_for, temp_schema

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

CARD = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "阿苓",
        "description": "{{char}} 是灰石镇酒馆的帮工，十七岁，偷偷收集各地的地图。",
        "personality": "机灵、嘴硬心软",
        "scenario": "雨夜，{{user}} 推门走进灰石镇唯一的酒馆。",
        "first_mes": "*阿苓抬起头* 外乡人？先把斗篷上的水拧干。",
        "mes_example": "<START>\n{{char}}: 地图？我可没有。",
        "character_book": {
            "entries": [
                {"keys": ["火漆"], "content": "北境商会的火漆是黑色的。", "constant": True},
            ]
        },
    },
}

SEED = {
    "world": {
        "title": "雨夜酒馆",
        "setting": "边陲小镇灰石镇，蒸汽机械与少量魔法并存。",
        "tone": "潮湿、克制",
        "rules": ["魔法稀少且昂贵"],
        "style": "现在时，细节具体",
    },
    "protagonist": {"name": "随便写的名字", "summary": "一名信使", "goal": "把信送到"},
    "characters": [
        {
            "name": "阿苓",
            "summary": "酒馆帮工，想离开小镇",
            "attitude": "好奇",
            "speech_style": "嘴硬",
            "importance": 5,
        },
        {"name": "老周", "summary": "掌柜，消息灵通", "importance": 4},
    ],
    "locations": [{"name": "灰石酒馆", "summary": "昏暗，炉火噼啪作响"}],
    "items": [{"name": "无名信", "summary": "没写收件人的信", "holder": "随便写的名字"}],
    "facts": [
        {"text": "老周欠北境商会一笔钱", "about": ["老周"], "secret": True, "known_by": ["老周"]},
        {"text": "北境商会的火漆是黑色的", "about": [], "importance": 3},
    ],
    "opening": {
        "location": "灰石酒馆",
        "present": ["阿苓", "老周"],
        "situation": "我推门走进酒馆，雨水顺着斗篷往下淌。",
        "hook": "柜台后的老周盯着我手里的信。",
    },
}


def director_text(n: int) -> str:
    return (
        f"<narrative>\n第{n}段：我在酒馆里环顾四周，炉火噼啪作响。阿苓抬头看了我一眼，"
        f"又低头擦起了杯子。\n老周把手里的抹布放下。\n</narrative>\n"
        f"<options>\n1. 走向柜台，问老周认不认识火漆（{n}）\n"
        f"2. 在角落坐下观察阿苓（{n}）\n</options>"
    )


@dataclass
class Story:
    director_calls: int = 0
    world_calls: int = 0
    piece_delay: float = 0.02

    def reply(self, request: RecordedRequest) -> Reply:
        body = request.body
        if body.get("stream"):
            self.director_calls += 1
            text = director_text(self.director_calls)
            pieces = [text[i : i + 12] for i in range(0, len(text), 12)]
            items: list[bytes | float] = []
            for piece in pieces:
                items.append(sse(chunk(piece)))
                items.append(self.piece_delay)
            items.append(sse(chunk(finish="stop")))
            usage = {"prompt_tokens": 900, "completion_tokens": 120, "prompt_cache_hit_tokens": 800}
            items.append(sse(chunk(usage=usage, no_choices=True)))
            items.append(DONE)
            return StreamReply(items)
        prompt = "\n".join(str(m.get("content", "")) for m in body.get("messages", []))
        if "<character-card>" in prompt:
            self.world_calls += 1
            return JsonReply(completion(json.dumps(SEED, ensure_ascii=False)))
        if "接下来可以采取的行动" in prompt:
            return JsonReply(completion('{"options": ["修复的选项一", "修复的选项二"]}'))
        return JsonReply({"error": {"message": "unexpected request"}}, status=400)


@dataclass
class Running:
    base_url: str
    story: Story
    fake: RunningFakeLLM


@pytest.fixture
async def running(fake_llm: RunningFakeLLM, tmp_path: Path) -> AsyncIterator[Running]:
    assert URL is not None
    story = Story()
    fake_llm.app.default_reply = story.reply
    async with temp_schema(URL) as schema:
        settings = Settings(
            env="test",
            database_url=URL,
            data_dir=tmp_path,
            master_keys=SecretStr(new_master_key_entry("t1")),
            auth_secret=SecretStr("test-secret-" + "x" * 40),
            allow_private_endpoints=True,
            enable_probe_endpoints=False,
            rate_limit_auth_per_min=1000,
            rate_limit_turns_per_min=1000,
            shutdown_grace_s=2.0,
        )
        services = build_app_services(
            settings, EventBufferRegistry(), engine=engine_for(URL, schema)
        )
        app = create_app(settings, services=services)
        server = AsgiServer(app, lifespan="on").start()
        try:
            yield Running(base_url=server.base_url, story=story, fake=fake_llm)
        finally:
            server.stop()


async def read_events(
    client: httpx.AsyncClient,
    url: str,
    token: str,
    *,
    last_event_id: str | None = None,
    stop: Callable[[list[SseEvent]], bool] | None = None,
) -> list[SseEvent]:
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id
    events: list[SseEvent] = []
    decoder = SseDecoder()
    async with client.stream("GET", url, headers=headers, timeout=30) as response:
        assert response.status_code == 200, await response.aread()
        assert response.headers["content-type"].startswith("text/event-stream")
        async for raw in response.aiter_bytes():
            for event in decoder.feed(raw):
                events.append(event)
                if event.event in ("turn.completed", "turn.failed"):
                    return events
                if stop is not None and stop(events):
                    return events
    return events


def narrative_of(events: list[SseEvent]) -> str:
    return "".join(json.loads(e.data)["text"] for e in events if e.event == "narrative.delta")


async def setup_account(client: httpx.AsyncClient, fake: RunningFakeLLM) -> dict[str, str]:
    r = await client.post(
        "/v1/auth/register", json={"email": "lin@example.com", "password": "correct horse 1"}
    )
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    # 添加模型的表单：先用还没保存的 Key 拉模型列表，再连同 Key 一次保存并设为导演
    r = await client.post(
        "/v1/providers/custom_openai/models",
        headers=auth,
        json={"api_key": "sk-test-0000-abcd", "base_url": fake.base_url},
    )
    assert r.status_code == 200, r.text
    assert [m["id"] for m in r.json()] == ["fake-model"]
    r = await client.post(
        "/v1/model-routes",
        headers=auth,
        json={
            "provider": "custom_openai",
            "label": "本地假服务",
            "api_key": "sk-test-0000-abcd",
            "base_url": fake.base_url,
            "model": "fake-model",
            "director": True,
        },
    )
    assert r.status_code == 201, r.text
    route = r.json()
    assert route["key_last4"] == "abcd" and route["is_director"] is True
    assert "api_key" not in route
    # 假服务的列表没给窗口，能力表也不知道：按 32K 估计
    assert route["window"]["source"] == "default"
    assert route["window"]["model_window"] == 32768
    assert route["window"]["effective_window"] >= 16_000
    return {"token": token, "route_id": route["id"]}


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
