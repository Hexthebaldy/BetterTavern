"""请求上下文：请求单号的收发、错误响应里的单号、访问日志、未处理异常的兜底。"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import structlog
from fastapi import FastAPI

from bettertavern.api.body_limit import BodySizeLimit
from bettertavern.api.deps import UserId
from bettertavern.api.errors import install_error_handlers
from bettertavern.api.request_context import RequestContext
from bettertavern.infra.observability.context import user_ref
from bettertavern.services.errors import NotFound

pytestmark = pytest.mark.anyio


def make_app() -> FastAPI:
    app = FastAPI()
    install_error_handlers(app)
    app.state.services = SimpleNamespace(auth=SimpleNamespace(authenticate=lambda token: "user-1"))

    @app.get("/items/{item_id}")
    async def item(item_id: str) -> dict[str, str]:
        structlog.get_logger("test").info("item.read", item_id=item_id)
        return {"id": item_id}

    @app.get("/missing")
    async def missing() -> None:
        raise NotFound()

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("password=hunter2 leaked")

    @app.get("/me")
    async def me(user_id: UserId) -> dict[str, str]:
        return {"user": user_id}

    @app.post("/upload")
    async def upload(payload: dict[str, str]) -> dict[str, int]:
        return {"keys": len(payload)}

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.add_middleware(BodySizeLimit, default=64)
    app.add_middleware(RequestContext)
    return app


def client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


def capture() -> Any:
    return structlog.testing.capture_logs(processors=[structlog.contextvars.merge_contextvars])


async def test_client_request_id_is_echoed_and_attached_to_logs() -> None:
    async with client(make_app()) as c:
        with capture() as logs:
            resp = await c.get(
                "/items/7", headers={"X-Request-ID": "app-req-0001", "X-Client-Version": "1.2.0"}
            )
    assert resp.headers["X-Request-ID"] == "app-req-0001"
    read = next(e for e in logs if e["event"] == "item.read")
    assert read["request_id"] == "app-req-0001"
    access = next(e for e in logs if e["event"] == "http.request")
    assert access["request_id"] == "app-req-0001"
    assert access["route"] == "/items/{item_id}"
    assert access["status"] == 200 and access["client_version"] == "1.2.0"
    assert isinstance(access["duration_ms"], int)


async def test_missing_or_malformed_request_ids_are_replaced() -> None:
    async with client(make_app()) as c:
        plain = await c.get("/items/1")
        bad = await c.get("/items/1", headers={"X-Request-ID": "bad id with spaces"})
    for resp in (plain, bad):
        generated = resp.headers["X-Request-ID"]
        assert len(generated) == 32 and generated.isalnum()
    assert plain.headers["X-Request-ID"] != bad.headers["X-Request-ID"]


async def test_error_bodies_carry_the_request_id() -> None:
    async with client(make_app()) as c:
        not_found = await c.get("/missing", headers={"X-Request-ID": "req-missing-1"})
        too_large = await c.post(
            "/upload", json={"k": "v" * 200}, headers={"X-Request-ID": "req-large-1"}
        )
    assert not_found.status_code == 404
    assert not_found.json()["request_id"] == "req-missing-1"
    assert not_found.headers["X-Request-ID"] == "req-missing-1"
    assert too_large.status_code == 413
    assert too_large.json()["request_id"] == "req-large-1"


async def test_unhandled_exceptions_become_500_with_the_request_id_and_are_logged() -> None:
    async with client(make_app()) as c:
        with capture() as logs:
            resp = await c.get("/boom", headers={"X-Request-ID": "req-boom-01"})
    assert resp.status_code == 500
    body = resp.json()
    assert body["code"] == "INTERNAL_ERROR" and body["retryable"] is True
    assert body["request_id"] == "req-boom-01"
    assert resp.headers["X-Request-ID"] == "req-boom-01"
    error = next(e for e in logs if e["event"] == "http.error")
    assert error["request_id"] == "req-boom-01" and error["path"] == "/boom"
    access = next(e for e in logs if e["event"] == "http.request")
    assert access["status"] == 500 and access["log_level"] == "warning"


async def test_authenticated_requests_log_a_user_reference_not_the_id() -> None:
    async with client(make_app()) as c:
        with capture() as logs:
            resp = await c.get("/me", headers={"Authorization": "Bearer t"})
    assert resp.json() == {"user": "user-1"}
    access = next(e for e in logs if e["event"] == "http.request")
    assert access["user_ref"] == user_ref("user-1")
    assert "user-1" not in str(access)


async def test_successful_health_checks_are_not_logged() -> None:
    async with client(make_app()) as c:
        with capture() as logs:
            await c.get("/health")
    assert not [e for e in logs if e["event"] == "http.request"]
