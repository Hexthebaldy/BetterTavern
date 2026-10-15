"""网页端的 Cookie 登录：真实 Postgres + 跑在 uvicorn 里的 api。

带 `X-Auth-Mode: cookie` 时刷新令牌只在 HttpOnly Cookie 里，刷新、退出凭 Cookie；
跨站请求被拒；不带这个请求头时和手机端一样。

    BT_TEST_DATABASE_URL=postgresql://bettertavern:bettertavern@localhost:5432/bettertavern \\
        uv run pytest tests/e2e/test_web_auth.py
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from http.cookies import Morsel, SimpleCookie
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr

from bettertavern.entrypoints.api import build_app_services, create_app
from bettertavern.infra.crypto.keyring import new_master_key_entry
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.settings import Settings
from tests.fakes.asgi_server import AsgiServer
from tests.support.pg import database_url, engine_for, temp_schema

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)

WEB_ORIGIN = "https://web.example"
# 浏览器从同源页面发出的请求带着这两个头；客户端自己加 X-Auth-Mode
SAME_ORIGIN = {"X-Auth-Mode": "cookie", "Sec-Fetch-Site": "same-origin"}
ACCOUNT = {"email": "lin@example.com", "password": "correct horse 1"}


@pytest.fixture
async def base_url(tmp_path: Path) -> AsyncIterator[str]:
    assert URL is not None
    async with temp_schema(URL) as schema:
        settings = Settings(
            env="test",
            database_url=URL,
            data_dir=tmp_path,
            master_keys=SecretStr(new_master_key_entry("t1")),
            auth_secret=SecretStr("test-secret-" + "x" * 40),
            enable_probe_endpoints=False,
            rate_limit_auth_per_min=1000,
            cors_origins=WEB_ORIGIN,
            shutdown_grace_s=2.0,
        )
        services = build_app_services(
            settings, EventBufferRegistry(), engine=engine_for(URL, schema)
        )
        server = AsgiServer(create_app(settings, services=services), lifespan="on").start()
        try:
            yield server.base_url
        finally:
            server.stop()


def refresh_cookie(response: httpx.Response) -> Morsel[str]:
    """响应里设置 bt_refresh 的那个 Set-Cookie（只能有一个）。"""
    found: list[Morsel[str]] = []
    for header in response.headers.get_list("set-cookie"):
        jar: SimpleCookie = SimpleCookie()
        jar.load(header)
        if "bt_refresh" in jar:
            found.append(jar["bt_refresh"])
    assert len(found) == 1, response.headers.get_list("set-cookie")
    return found[0]


def assert_cleared(response: httpx.Response) -> None:
    cookie = refresh_cookie(response)
    assert cookie["max-age"] == "0"
    assert cookie["path"] == "/v1/auth"


async def test_cookie_login_refresh_and_logout(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        r = await client.post("/v1/auth/register", json=ACCOUNT, headers=SAME_ORIGIN)
        assert r.status_code == 201, r.text
        # 刷新令牌不进响应体，只在 HttpOnly Cookie 里
        assert r.json()["refresh_token"] is None
        cookie = refresh_cookie(r)
        first = cookie.value
        assert first.startswith("rt_")
        assert cookie["httponly"] and cookie["secure"]
        assert cookie["path"] == "/v1/auth"
        assert cookie["samesite"].lower() == "strict"
        assert int(cookie["max-age"]) > 29 * 86400
        access = r.json()["access_token"]
        me = await client.get("/v1/me", headers={"Authorization": f"Bearer {access}"})
        assert me.json()["email"] == ACCOUNT["email"]

        # 刷新只凭 Cookie，不带请求体；Cookie 换成新的令牌
        r = await client.post(
            "/v1/auth/refresh", headers={**SAME_ORIGIN, "Cookie": f"bt_refresh={first}"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["refresh_token"] is None
        assert r.json()["user"]["email"] == ACCOUNT["email"]
        second = refresh_cookie(r).value
        assert second.startswith("rt_") and second != first

        # 登录也一样（每次登录是新的令牌家族）
        r = await client.post("/v1/auth/login", json=ACCOUNT, headers=SAME_ORIGIN)
        assert r.status_code == 200 and r.json()["refresh_token"] is None
        assert refresh_cookie(r).value not in (first, second)

        # 退出：吊销这一族，同时让浏览器删掉 Cookie
        r = await client.post(
            "/v1/auth/logout", headers={**SAME_ORIGIN, "Cookie": f"bt_refresh={second}"}
        )
        assert r.status_code == 204
        assert_cleared(r)
        r = await client.post(
            "/v1/auth/refresh", headers={**SAME_ORIGIN, "Cookie": f"bt_refresh={second}"}
        )
        assert r.status_code == 401 and r.json()["code"] == "REFRESH_INVALID"


async def test_rejected_refresh_clears_the_cookie(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        # 没有 Cookie（第一次打开网页）：401，网页去登录页
        r = await client.post("/v1/auth/refresh", headers=SAME_ORIGIN)
        assert r.status_code == 401 and r.json()["code"] == "REFRESH_INVALID"
        assert_cleared(r)
        r = await client.post(
            "/v1/auth/refresh", headers={**SAME_ORIGIN, "Cookie": "bt_refresh=rt_made_up"}
        )
        assert r.status_code == 401 and r.json()["code"] == "REFRESH_INVALID"
        assert_cleared(r)
        # Cookie 模式只认 Cookie，请求体里的令牌不算
        r = await client.post("/v1/auth/register", json=ACCOUNT)
        token = r.json()["refresh_token"]
        r = await client.post(
            "/v1/auth/refresh", json={"refresh_token": token}, headers=SAME_ORIGIN
        )
        assert r.status_code == 401
        # 没有 Cookie 时退出也成功，照样让浏览器删掉
        r = await client.post("/v1/auth/logout", headers=SAME_ORIGIN)
        assert r.status_code == 204
        assert_cleared(r)


async def test_cross_site_requests_are_refused(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        evil = {"X-Auth-Mode": "cookie", "Sec-Fetch-Site": "cross-site"}
        for headers in (evil, {**evil, "Origin": "https://evil.example"}):
            r = await client.post("/v1/auth/login", json=ACCOUNT, headers=headers)
            assert r.status_code == 403 and r.json()["code"] == "CROSS_SITE"
            assert not r.headers.get_list("set-cookie")
        r = await client.post(
            "/v1/auth/refresh", headers={**evil, "Cookie": "bt_refresh=rt_made_up"}
        )
        assert r.status_code == 403 and r.json()["code"] == "CROSS_SITE"
        # 网页放在 CORS_ORIGINS 里列出的另一个域名下：放行
        r = await client.post(
            "/v1/auth/register", json=ACCOUNT, headers={**evil, "Origin": WEB_ORIGIN}
        )
        assert r.status_code == 201, r.text
        refresh_cookie(r)
        # 不认识的模式
        r = await client.post("/v1/auth/login", json=ACCOUNT, headers={"X-Auth-Mode": "session"})
        assert r.status_code == 422 and r.json()["field"] == "X-Auth-Mode"


async def test_body_mode_is_unchanged(base_url: str) -> None:
    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:
        r = await client.post("/v1/auth/register", json=ACCOUNT)
        assert r.status_code == 201
        assert not r.headers.get_list("set-cookie")
        token = r.json()["refresh_token"]
        assert token.startswith("rt_")
        # 不带请求头时 Cookie 不算数，刷新令牌必须在请求体里
        r = await client.post("/v1/auth/refresh", headers={"Cookie": f"bt_refresh={token}"})
        assert r.status_code == 422 and r.json()["field"] == "refresh_token"
        r = await client.post("/v1/auth/refresh", json={"refresh_token": token})
        assert r.status_code == 200
        assert r.json()["refresh_token"].startswith("rt_")
        assert not r.headers.get_list("set-cookie")
        r = await client.post("/v1/auth/logout", json={"refresh_token": r.json()["refresh_token"]})
        assert r.status_code == 204
        assert not r.headers.get_list("set-cookie")
