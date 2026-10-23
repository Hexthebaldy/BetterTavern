"""端到端测试共用的部分：测试用角色卡、假模型的剧情、起一个完整 api、读事件流、建账号加模型。

test_m1_flow.py、test_workbench_manual.py 等共用；各自在自己的 fixture 里调用 serve()。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
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
        },
        {"name": "老周", "summary": "掌柜，消息灵通"},
    ],
    "locations": [{"name": "灰石酒馆", "summary": "昏暗，炉火噼啪作响"}],
    "items": [{"name": "无名信", "summary": "没写收件人的信", "holder": "随便写的名字"}],
    "facts": [
        {"text": "老周欠北境商会一笔钱", "about": ["老周"], "secret": True, "known_by": ["老周"]},
        {"text": "北境商会的火漆是黑色的", "about": []},
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
        if "接下来可以采取的行动" in prompt or "actions the player could take next" in prompt:
            return JsonReply(completion('{"options": ["修复的选项一", "修复的选项二"]}'))
        return JsonReply({"error": {"message": "unexpected request"}}, status=400)


@dataclass
class Running:
    base_url: str
    story: Story
    fake: RunningFakeLLM


@asynccontextmanager
async def serve(fake_llm: RunningFakeLLM, tmp_path: Path, **extra: Any) -> AsyncIterator[Running]:
    """在临时 schema 里起一个完整的 api（假模型服务回复 Story 的内容），用完拆掉。

    extra：额外的配置，比如官方模型。
    """
    url = database_url()
    assert url is not None, "需要 BT_TEST_DATABASE_URL"
    story = Story()
    fake_llm.app.default_reply = story.reply
    async with temp_schema(url) as schema:
        settings = Settings(
            env="test",
            database_url=url,
            data_dir=tmp_path,
            master_keys=SecretStr(new_master_key_entry("t1")),
            auth_secret=SecretStr("test-secret-" + "x" * 40),
            allow_private_endpoints=True,
            enable_probe_endpoints=False,
            rate_limit_auth_per_min=1000,
            rate_limit_turns_per_min=1000,
            shutdown_grace_s=2.0,
            **extra,
        )
        services = build_app_services(
            settings, EventBufferRegistry(), engine=engine_for(url, schema)
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


async def import_scenario(
    client: httpx.AsyncClient, auth: dict[str, str], card: dict[str, object] = CARD
) -> dict[str, object]:
    """导入一张卡（变成草稿）→ 保存进角色卡仓库，顺便建一个剧本；返回保存接口的响应。"""
    files = {"file": ("card.json", json.dumps(card, ensure_ascii=False).encode(), "text/json")}
    r = await client.post("/v1/workbench/drafts/import", headers=auth, files=files)
    assert r.status_code == 201, r.text
    draft_id = r.json()["draft"]["draft"]["id"]
    r = await client.post(
        f"/v1/workbench/drafts/{draft_id}/save", headers=auth, json={"new_scenario": True}
    )
    assert r.status_code == 200, r.text
    return r.json()
