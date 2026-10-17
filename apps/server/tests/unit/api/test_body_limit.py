"""请求体大小限制：声明的长度超限直接 413；分块上传边收边数，超限时中止；带 id 的路径按正则配置。"""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest
from fastapi import FastAPI, File, UploadFile

from bettertavern.api.body_limit import BodySizeLimit
from bettertavern.api.errors import install_error_handlers

pytestmark = pytest.mark.anyio


def make_app() -> tuple[FastAPI, list[int]]:
    app = FastAPI()
    install_error_handlers(app)
    seen: list[int] = []

    @app.post("/upload")
    async def upload(file: UploadFile = File(...)) -> dict[str, int]:  # noqa: B008
        data = await file.read()
        seen.append(len(data))
        return {"size": len(data)}

    @app.post("/json")
    async def json_body(payload: dict[str, str]) -> dict[str, int]:
        return {"keys": len(payload)}

    @app.put("/items/{item_id}/card")
    async def card(item_id: str, payload: dict[str, str]) -> dict[str, int]:
        return {"chars": sum(len(v) for v in payload.values())}

    app.add_middleware(
        BodySizeLimit,
        default=1024,
        limits={"/upload": 64 * 1024},
        patterns=[(r"^/items/[^/]+/card$", 8 * 1024)],
    )
    return app, seen


async def client_for(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_declared_length_over_the_limit_is_rejected_before_reading() -> None:
    app, seen = make_app()
    async with await client_for(app) as client:
        response = await client.post("/upload", files={"file": ("a.png", b"x" * (80 * 1024))})
        assert response.status_code == 413
        assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
        assert seen == []
        ok = await client.post("/upload", files={"file": ("a.png", b"x" * 1000)})
        assert ok.status_code == 200 and ok.json() == {"size": 1000}


async def test_chunked_body_is_counted_while_streaming() -> None:
    app, _seen = make_app()

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(64):
            yield b'{"k": "' + b"y" * 100 + b'"}'

    async with await client_for(app) as client:
        response = await client.post(
            "/json", content=chunks(), headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 413
        assert response.json()["code"] == "PAYLOAD_TOO_LARGE"
        small = await client.post("/json", json={"a": "b"})
        assert small.status_code == 200


async def test_paths_with_ids_use_the_pattern_limit() -> None:
    app, _seen = make_app()
    async with await client_for(app) as client:
        # 4 KB 超过默认的 1 KB，但没超过这个路径的 8 KB
        ok = await client.put("/items/abc/card", json={"text": "x" * 4096})
        assert ok.status_code == 200 and ok.json() == {"chars": 4096}
        too_big = await client.put("/items/abc/card", json={"text": "x" * 9000})
        assert too_big.status_code == 413
        # 不匹配的路径仍用默认上限
        other = await client.post("/json", json={"text": "x" * 4096})
        assert other.status_code == 413
