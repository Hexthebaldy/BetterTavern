"""朗读（F6，docs/speech.md）端到端：真实 Postgres + 跑在 uvicorn 里的 api，语音服务是假的。

没配服务时不能读 → 配上一个朗读服务 → 列声音 → 读一小段（声音原样传回来）→ 服务出错时按原因报错 →
“测试”按钮 → 指定的服务不存在或不是朗读服务 → 限流。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_speech.py
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from tests.e2e.m1_app import serve
from tests.fakes.llm_server import JsonReply, RunningFakeLLM, StreamReply
from tests.support.pg import database_url

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

if not database_url():
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

MP3 = b"ID3fake-mp3-audio"


def audio_reply() -> StreamReply:
    return StreamReply(items=[MP3], content_type="audio/mpeg")


async def register(client: httpx.AsyncClient, email: str = "lin@example.com") -> dict[str, str]:
    r = await client.post("/v1/auth/register", json={"email": email, "password": "correct horse 1"})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def add_speech(
    client: httpx.AsyncClient, auth: dict[str, str], fake: RunningFakeLLM, **params: str
) -> dict[str, str]:
    r = await client.post(
        "/v1/tool-routes",
        headers=auth,
        json={
            "kind": "speech",
            "provider": "openai_speech",
            "label": "本地假语音",
            "api_key": "sk-speech-0000-wxyz",
            "base_url": fake.base_url,
            "model": "fake-tts",
            "params": params,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_read_a_passage_through_my_speech_service(
    fake_llm: RunningFakeLLM, tmp_path: Path
) -> None:
    async with (
        serve(fake_llm, tmp_path) as app,
        httpx.AsyncClient(base_url=app.base_url, timeout=30) as client,
    ):
        auth = await register(client)

        # 设置页看得到三种协议
        providers = (await client.get("/v1/tool-providers", headers=auth)).json()
        speech = {p["id"]: p for p in providers if "speech" in p["kinds"]}
        assert set(speech) == {"openai_speech", "gemini", "elevenlabs"}
        assert speech["openai_speech"]["needs_model"] is True
        assert speech["elevenlabs"]["needs_model"] is False

        # 还没配服务
        r = await client.post("/v1/speech", headers=auth, json={"text": "前面就是渡口了"})
        assert r.status_code == 409 and r.json()["code"] == "SPEECH_NOT_CONFIGURED"

        # 配的时候检查协议和模型名
        base = {"kind": "speech", "api_key": "sk-speech-0000-wxyz"}
        r = await client.post(
            "/v1/tool-routes", headers=auth, json={**base, "provider": "openai_images"}
        )
        assert r.status_code == 422 and r.json()["field"] == "provider"
        r = await client.post(
            "/v1/tool-routes", headers=auth, json={**base, "provider": "openai_speech"}
        )
        assert r.status_code == 422 and r.json()["field"] == "model"

        route = await add_speech(client, auth, app.fake)
        assert route["kind"] == "speech" and route["is_default"] is True
        assert route["key_last4"] == "wxyz" and "api_key" not in route

        # 列声音：这个协议是固定的一串
        r = await client.get(f"/v1/tool-routes/{route['id']}/voices", headers=auth)
        assert r.status_code == 200
        assert {"id": "alloy", "name": "alloy"} in r.json()

        # 读一小段：声音原样传回来，不留缓存；请求用的是存着的 Key、指定的声音
        app.fake.app.replies.append(audio_reply())
        r = await client.post(
            "/v1/speech", headers=auth, json={"text": " 前面就是渡口了 ", "voice": "coral"}
        )
        assert r.status_code == 200, r.text
        assert r.content == MP3
        assert r.headers["content-type"].startswith("audio/mpeg")
        assert r.headers["cache-control"] == "no-store"
        request = app.fake.app.requests[-1]
        assert request.path.endswith("/audio/speech")
        assert request.headers["authorization"] == "Bearer sk-speech-0000-wxyz"
        assert request.body["input"] == "前面就是渡口了" and request.body["voice"] == "coral"

        # 没说用哪个声音：用这个协议的第一个声音
        app.fake.app.replies.append(audio_reply())
        r = await client.post("/v1/speech", headers=auth, json={"text": "你在这里等我"})
        assert r.status_code == 200 and app.fake.app.requests[-1].body["voice"] == "alloy"

        # 服务出错：按原因报，客户端据此翻译
        app.fake.app.replies.append(JsonReply({"error": "bad key"}, status=401))
        r = await client.post("/v1/speech", headers=auth, json={"text": "你在这里等我"})
        assert r.status_code == 502
        assert r.json()["code"] == "SPEECH_FAILED" and r.json()["reason"] == "auth"
        assert "sk-speech" not in r.text
        app.fake.app.replies.append(JsonReply({"error": "slow down"}, status=429))
        r = await client.post("/v1/speech", headers=auth, json={"text": "你在这里等我"})
        assert r.json()["reason"] == "quota" and r.json()["retryable"] is True

        # 文字太长、只有空白
        r = await client.post("/v1/speech", headers=auth, json={"text": "字" * 1001})
        assert r.status_code == 422
        r = await client.post("/v1/speech", headers=auth, json={"text": "   "})
        assert r.status_code == 422 and r.json()["field"] == "text"

        # “测试”真的读一句
        app.fake.app.replies.append(audio_reply())
        r = await client.post(f"/v1/tool-routes/{route['id']}/test", headers=auth)
        assert r.status_code == 200 and r.json()["status"] == "ok", r.text
        app.fake.app.replies.append(JsonReply({}, status=401))
        r = await client.post(f"/v1/tool-routes/{route['id']}/test", headers=auth)
        assert r.json()["status"] == "invalid" and r.json()["probe"]["detail"].startswith("auth")

        # 指定第二个服务；填了默认声音时不说用哪个就用它，列表里它排最前面
        second = await add_speech(client, auth, app.fake, voice="my-own-voice")
        assert second["is_default"] is False
        app.fake.app.replies.append(audio_reply())
        r = await client.post(
            "/v1/speech", headers=auth, json={"text": "好", "route_id": second["id"]}
        )
        assert r.status_code == 200
        assert app.fake.app.requests[-1].body["voice"] == "my-own-voice"
        r = await client.get(f"/v1/tool-routes/{second['id']}/voices", headers=auth)
        assert r.json()[0]["id"] == "my-own-voice"

        # 不存在的服务、别的种类的服务、别人的服务都是 404
        image = await client.post(
            "/v1/tool-routes",
            headers=auth,
            json={
                "kind": "image",
                "provider": "openai_images",
                "api_key": "sk-image-0000-wxyz",
                "model": "fake-image",
            },
        )
        other = await register(client, "other@example.com")
        for route_id, headers in (
            ("nope", auth),
            (image.json()["id"], auth),
            (route["id"], other),
        ):
            r = await client.post(
                "/v1/speech", headers=headers, json={"text": "好", "route_id": route_id}
            )
            assert r.status_code == 404, r.text
            r = await client.get(f"/v1/tool-routes/{route_id}/voices", headers=headers)
            assert r.status_code == 404, r.text

        # 要登录
        r = await client.post("/v1/speech", json={"text": "好"})
        assert r.status_code == 401


async def test_speech_is_rate_limited(fake_llm: RunningFakeLLM, tmp_path: Path) -> None:
    async with (
        serve(fake_llm, tmp_path, rate_limit_speech_per_min=2) as app,
        httpx.AsyncClient(base_url=app.base_url, timeout=30) as client,
    ):
        auth = await register(client)
        await add_speech(client, auth, app.fake)
        for _ in range(2):
            app.fake.app.replies.append(audio_reply())
            r = await client.post("/v1/speech", headers=auth, json={"text": "好"})
            assert r.status_code == 200, r.text
        r = await client.post("/v1/speech", headers=auth, json={"text": "好"})
        assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED"
