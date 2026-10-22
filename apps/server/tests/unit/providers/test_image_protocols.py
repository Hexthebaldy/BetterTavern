"""文生图的三种接口协议：请求的样子、返回的图（base64 或地址）、参考图、出错（用假的 HTTP）。"""

from __future__ import annotations

import base64
import json

import httpx
import pytest

from bettertavern.providers.image import IMAGE_PROTOCOLS, ImageConfig, ImageError, Reference

pytestmark = pytest.mark.anyio

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()


def client(handler):  # type: ignore[no-untyped-def]
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_openai_images_generations_and_edits() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/images/generations"):
            body = json.loads(request.content)
            assert body["size"] == "1024x1536" and body["n"] == 2 and body["quality"] == "low"
            return httpx.Response(
                200, json={"data": [{"b64_json": PNG}, {"url": "https://img/2.png"}]}
            )
        assert request.url.path.endswith("/images/edits")
        assert b'name="image[]"' in request.content
        return httpx.Response(200, json={"data": [{"b64_json": PNG}]})

    protocol = IMAGE_PROTOCOLS["openai_images"]
    config = ImageConfig(
        model="gpt-image-1", api_key="k", params={"extra_body": {"quality": "low"}}
    )
    async with client(handler) as http:
        images = await protocol.generate(
            http, config, prompt="一个掌柜", aspect="portrait", count=2
        )
        assert images[0].data is not None and images[0].data.startswith(b"\x89PNG")
        assert images[1].url == "https://img/2.png"
        edited = await protocol.generate(
            http,
            config,
            prompt="p",
            aspect="square",
            count=1,
            references=[Reference(data=b"\x89PNG", mime="image/png")],
        )
    assert len(edited) == 1
    assert seen[0].headers["authorization"] == "Bearer k"
    assert str(seen[0].url).startswith("https://api.openai.com/v1/")


async def test_openai_chat_reads_images_from_the_reply() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["modalities"] == ["image", "text"]
        assert body["messages"][0]["content"][1]["type"] == "image_url"
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "好的",
                            "images": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": f"data:image/png;base64,{PNG}"},
                                }
                            ],
                        }
                    }
                ]
            },
        )

    protocol = IMAGE_PROTOCOLS["openai_chat"]
    config = ImageConfig(model="m", api_key="k", base_url="https://openrouter.example/api/v1")
    async with client(handler) as http:
        images = await protocol.generate(
            http,
            config,
            prompt="p",
            aspect="portrait",
            count=2,
            references=[Reference(data=b"x", mime="image/png")],
        )
    assert len(images) == 2 and all(i.data for i in images)


async def test_gemini_uses_the_key_header_not_the_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert "key=" not in str(request.url)
        assert request.headers["x-goog-api-key"] == "g-key"
        assert request.url.path.endswith("/models/gemini-image:generateContent")
        body = json.loads(request.content)
        assert body["generationConfig"]["imageConfig"]["aspectRatio"] == "2:3"
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": "here"},
                                {"inlineData": {"mimeType": "image/png", "data": PNG}},
                            ]
                        }
                    }
                ]
            },
        )

    protocol = IMAGE_PROTOCOLS["gemini"]
    async with client(handler) as http:
        images = await protocol.generate(
            http,
            ImageConfig(model="gemini-image", api_key="g-key"),
            prompt="p",
            aspect="portrait",
            count=1,
        )
    assert images[0].data is not None


async def test_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429)

    async with client(handler) as http:
        with pytest.raises(ImageError) as info:
            await IMAGE_PROTOCOLS["openai_images"].generate(
                http, ImageConfig(model="m", api_key="k"), prompt="p", aspect="square", count=1
            )
    assert info.value.kind == "quota"
