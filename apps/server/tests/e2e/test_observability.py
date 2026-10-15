"""日志的端到端检查：真实 Postgres + 假 LLM 服务 + 跑在 uvicorn 里的 api，日志写进临时文件。

在角色卡、玩家的行动、模型写的叙述里都埋一个暗号，跑完一个回合后检查日志文件：
- 暗号、API Key、密码、邮箱都不出现在日志里；
- 回合的各个步骤按顺序出现，并且都带着提交它的那次请求的单号和回合编号；
- 访问日志带用户代号，不带用户 id。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_observability.py
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest
import structlog
from pydantic import SecretStr

from bettertavern.entrypoints.api import build_app_services, create_app
from bettertavern.infra.crypto.keyring import new_master_key_entry
from bettertavern.infra.observability.logging import configure_logging
from bettertavern.providers.sse_parser import SseDecoder
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.settings import Settings
from bettertavern.vis.app import create_vis_app
from bettertavern.vis.logstore import LogStore
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

SECRET = "暗号-青铜灯笼-7Q2X"
EMAIL = "observer@example.com"
PASSWORD = "correct horse 9"
API_KEY = "sk-test-9999-wxyz"
TURN_REQUEST_ID = "e2e-turn-request-01"

CARD = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "守灯人",
        "description": f"{{{{char}}}} 守着一盏{SECRET}。",
        "first_mes": f"*{SECRET}在风里晃*",
    },
}


def reply(request: RecordedRequest) -> Reply:
    body = request.body
    if body.get("stream"):
        text = (
            f"<narrative>\n我看见{SECRET}在雨里亮着。\n</narrative>\n"
            "<options>\n1. 走近那盏灯\n2. 转身离开\n</options>"
        )
        items: list[bytes | float] = [sse(chunk(text[i : i + 10])) for i in range(0, len(text), 10)]
        items.append(sse(chunk(finish="stop")))
        usage = {"prompt_tokens": 900, "completion_tokens": 60, "prompt_cache_hit_tokens": 800}
        items.append(sse(chunk(usage=usage, no_choices=True)))
        items.append(DONE)
        return StreamReply(items)
    # WorldBuilder：返回一个最小的种子
    seed = {"world": {"title": "雨夜"}, "protagonist": {"name": "我", "summary": SECRET}}
    return JsonReply(completion(json.dumps(seed, ensure_ascii=False)))


@pytest.fixture
def log_file(tmp_path: Path) -> Iterator[Path]:
    root = logging.getLogger()
    saved = (list(root.handlers), root.level)
    file = tmp_path / "logs" / "api.log"
    configure_logging(level="DEBUG", process="api", fmt="json", file=file, cache=False)
    try:
        yield file
    finally:
        for handler in list(root.handlers):
            root.removeHandler(handler)
            handler.close()
        for handler in saved[0]:
            root.addHandler(handler)
        root.setLevel(saved[1])
        structlog.reset_defaults()


@dataclass
class Running:
    base_url: str
    schema: str


@pytest.fixture
async def running(
    fake_llm: RunningFakeLLM, tmp_path: Path, log_file: Path
) -> AsyncIterator[Running]:
    assert URL is not None
    fake_llm.app.default_reply = reply
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
        server = AsgiServer(create_app(settings, services=services), lifespan="on").start()
        try:
            yield Running(server.base_url, schema)
        finally:
            server.stop()


async def finish(client: httpx.AsyncClient, url: str, token: str) -> None:
    """读事件流直到回合结束"""
    headers = {"Authorization": f"Bearer {token}", "Accept": "text/event-stream"}
    decoder = SseDecoder()
    async with client.stream("GET", url, headers=headers, timeout=30) as response:
        async for raw in response.aiter_bytes():
            for event in decoder.feed(raw):
                if event.event in ("turn.completed", "turn.failed"):
                    assert event.event == "turn.completed", event.data
                    return


def read_log(file: Path) -> tuple[str, list[dict[str, Any]]]:
    for handler in logging.getLogger().handlers:
        handler.flush()
    text = file.read_text(encoding="utf-8")
    return text, [json.loads(line) for line in text.splitlines()]


@dataclass
class Played:
    user_id: str
    playthrough_id: str
    turn_id: str


async def play_two_turns(base_url: str, fake_llm: RunningFakeLLM) -> Played:
    """注册、配模型、导入角色卡、开局，再提交一个行动；每一步都带上暗号"""
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        r = await client.post("/v1/auth/register", json={"email": EMAIL, "password": PASSWORD})
        token = r.json()["access_token"]
        user_id = r.json()["user"]["id"]
        auth = {"Authorization": f"Bearer {token}"}
        await client.post(
            "/v1/model-routes",
            headers=auth,
            json={
                "provider": "custom_openai",
                "api_key": API_KEY,
                "base_url": fake_llm.base_url,
                "model": "fake-model",
                "director": True,
            },
        )
        files = {"file": ("card.json", json.dumps(CARD, ensure_ascii=False).encode(), "text/json")}
        scenario = (await client.post("/v1/scenarios/import", headers=auth, files=files)).json()
        r = await client.post(
            "/v1/playthroughs",
            headers=auth,
            json={
                "scenario_id": scenario["id"],
                "protagonist": {"name": "林川", "summary": f"带着{SECRET}的人"},
            },
        )
        created = r.json()
        await finish(client, created["events_url"], token)
        playthrough_id = created["playthrough"]["id"]
        head = (await client.get(f"/v1/playthroughs/{playthrough_id}", headers=auth)).json()
        r = await client.post(
            f"/v1/playthroughs/{playthrough_id}/turns",
            headers={**auth, "X-Request-ID": TURN_REQUEST_ID},
            json={
                "parent_turn_id": head["playthrough"]["head_turn_id"],
                "action": {"source": "text", "text": f"我举起{SECRET}"},
            },
        )
        assert r.status_code == 201, r.text
        assert r.headers["X-Request-ID"] == TURN_REQUEST_ID
        turn_id = r.json()["turn"]["id"]
        await finish(client, r.json()["events_url"], token)
    return Played(user_id, playthrough_id, turn_id)


async def test_a_turn_leaves_a_complete_trail_without_story_or_secrets(
    running: Running, log_file: Path, fake_llm: RunningFakeLLM
) -> None:
    played = await play_two_turns(running.base_url, fake_llm)
    user_id, playthrough_id, turn_id = played.user_id, played.playthrough_id, played.turn_id

    text, entries = read_log(log_file)
    for secret in (SECRET, API_KEY, PASSWORD, EMAIL, user_id):
        assert secret not in text, f"日志里出现了不该有的内容：{secret}"

    turn = [e for e in entries if e.get("turn_id") == turn_id]
    generation = [e["event"] for e in turn if e.get("request_id") == TURN_REQUEST_ID]
    expected = [
        "turn.submitted",
        "turn.started",
        "context.assembled",
        "provider.request",
        "provider.first_token",
        "provider.response",
        "director.parse",
        "turn.committed",
    ]
    assert [name for name in generation if name in expected] == expected
    committed = next(e for e in turn if e["event"] == "turn.committed")
    assert committed["duration_ms"] >= 0 and committed["playthrough_id"] == playthrough_id
    response = next(e for e in turn if e["event"] == "provider.response")
    assert response["completion_tokens"] == 60 and response["cached_tokens"] == 800

    closed = [e for e in turn if e["event"] == "sse.close"]
    assert closed and closed[-1]["reason"] == "completed" and closed[-1]["events_sent"] > 0

    access = [e for e in entries if e["event"] == "http.request" and e.get("user_ref")]
    assert access and all(e["user_ref"].startswith("u_") for e in access)
    submit = next(e for e in access if e.get("request_id") == TURN_REQUEST_ID)
    assert submit["status"] == 201 and submit["route"] == "/v1/playthroughs/{playthrough_id}/turns"


async def test_vis_shows_the_turn_without_story_unless_asked(
    running: Running, log_file: Path, fake_llm: RunningFakeLLM
) -> None:
    played = await play_two_turns(running.base_url, fake_llm)
    for handler in logging.getLogger().handlers:
        handler.flush()
    assert URL is not None
    vis = create_vis_app(
        store=LogStore(log_file.parent, min_interval_s=0),
        engine=engine_for(URL, running.schema),
        web_dir=None,
        story_allowed=True,
        env="test",
    )
    transport = httpx.ASGITransport(app=vis)
    async with (
        vis.router.lifespan_context(vis),
        httpx.AsyncClient(transport=transport, base_url="http://vis") as client,
    ):
        meta = (await client.get("/api/meta")).json()
        assert meta["db"] is True and meta["logs"]["entries"] > 0

        listed = (await client.get("/api/playthroughs")).json()["playthroughs"]
        assert [p["id"] for p in listed] == [played.playthrough_id]
        assert listed[0]["turns"] == 2 and listed[0]["user_ref"].startswith("u_")

        pt = (await client.get(f"/api/playthroughs/{played.playthrough_id}")).json()
        assert [t["seq"] for t in pt["turns"]] == [0, 1]
        assert pt["turns"][1]["run"]["output_tokens"] == 60

        r = await client.get(f"/api/turns/{played.turn_id}")
        detail = r.json()
        assert SECRET not in r.text
        assert detail["turn"]["action"]["text_chars"] > 0
        assert "text" not in detail["turn"]["action"]
        kinds = [s["kind"] for s in detail["timeline"]["spans"]]
        for kind in ("http", "turn", "provider_wait", "provider_stream", "commit", "sse"):
            assert kind in kinds, kind
        assert detail["runs"][0]["agent"] == "director"

        shown = (await client.get(f"/api/turns/{played.turn_id}?story=1")).json()
        assert SECRET in shown["turn"]["narrative"]
        assert SECRET in shown["turn"]["action"]["text"]

        failed = (await client.get("/api/requests?kind=failed")).json()["requests"]
        assert failed == []
        submitted = next(
            r
            for r in (await client.get("/api/requests")).json()["requests"]
            if r["request_id"] == TURN_REQUEST_ID
        )
        assert submitted["turn_ids"] == [played.turn_id]

        found = (await client.get(f"/api/search?q={TURN_REQUEST_ID[:10]}")).json()["results"]
        assert {"kind": "request", "id": TURN_REQUEST_ID} in found
        found = (await client.get(f"/api/search?q={played.turn_id[:8]}")).json()["results"]
        assert any(f["kind"] == "turn" and f["id"] == played.turn_id for f in found)

        overview = (await client.get("/api/overview")).json()
        assert overview["db"]["turns"]["ok"] == 2
        assert overview["db"]["director"]["output_tokens"] == 120

        logs = (await client.get(f"/api/logs?id={played.turn_id}&level=info")).json()
        assert logs["entries"]
        assert all(e.get("turn_id") == played.turn_id for e in logs["entries"])
        later = (await client.get(f"/api/logs?after={logs['cursor']}")).json()
        assert later["entries"] == []
