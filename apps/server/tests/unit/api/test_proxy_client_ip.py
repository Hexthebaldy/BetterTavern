"""经反向代理访问时，限流按每个用户的真实 IP 计数。

模拟 Docker 部署：宿主机上的 nginx 经 Docker 网关（172.18.0.1）连进容器，
真实 IP 在 X-Forwarded-For 里。服务器要按 FORWARDED_ALLOW_IPS 决定信不信这个头。
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request

from bettertavern.api.deps import check_rate, client_ip
from bettertavern.api.errors import install_error_handlers
from bettertavern.entrypoints.server import proxy_options
from bettertavern.infra.ratelimit import RateLimiter
from bettertavern.settings import Settings

pytestmark = pytest.mark.anyio

DOCKER_GATEWAY = ("172.18.0.1", 51234)
DOCKER_RANGES = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"


def served(forwarded_allow_ips: str) -> Any:
    """和 bettertavern serve 一样经 uvicorn 包装的应用；登录接口每个 IP 每分钟 5 次"""
    limiter = RateLimiter(5)
    app = FastAPI()
    install_error_handlers(app)

    @app.post("/login")
    async def login(request: Request) -> dict[str, str]:
        ip = client_ip(request)
        check_rate(limiter, f"login:{ip}")
        return {"ip": ip}

    config = uvicorn.Config(app, **proxy_options(Settings(forwarded_allow_ips=forwarded_allow_ips)))
    config.load()
    return config.loaded_app


def connect(app: Any, peer: tuple[str, int] = DOCKER_GATEWAY) -> httpx.AsyncClient:
    """peer 是连进服务器的那一端：经 Docker 时是网关，直连时是用户自己"""
    transport = httpx.ASGITransport(app=app, client=peer)
    return httpx.AsyncClient(transport=transport, base_url="http://api")


async def login_as(client: httpx.AsyncClient, forwarded_for: str) -> httpx.Response:
    return await client.post("/login", headers={"X-Forwarded-For": forwarded_for})


async def test_users_behind_the_docker_proxy_have_their_own_limits() -> None:
    async with connect(served(DOCKER_RANGES)) as client:
        first = [await login_as(client, "203.0.113.5") for _ in range(5)]
        assert [r.status_code for r in first] == [200] * 5
        assert first[0].json() == {"ip": "203.0.113.5"}
        # 第一个用户用完了自己的 5 次，第二个用户不受影响
        assert (await login_as(client, "203.0.113.5")).status_code == 429
        assert (await login_as(client, "198.51.100.8")).status_code == 200


async def test_default_settings_lump_everyone_behind_docker_together() -> None:
    # 只信本机（默认值）时，经 Docker 网关来的请求全算成网关的地址：这就是修复前的样子
    async with connect(served("127.0.0.1,::1")) as client:
        for _ in range(5):
            assert (await login_as(client, "203.0.113.5")).json() == {"ip": "172.18.0.1"}
        assert (await login_as(client, "198.51.100.8")).status_code == 429


async def test_forged_header_does_not_get_a_fresh_limit() -> None:
    # 用户自己在请求里塞一个假 IP：nginx 会把真实 IP 追加在最后，服务器取的是最后那个
    async with connect(served(DOCKER_RANGES)) as client:
        for n in range(5):
            response = await login_as(client, f"1.1.1.{n}, 203.0.113.5")
            assert response.json() == {"ip": "203.0.113.5"}
        assert (await login_as(client, "9.9.9.9, 203.0.113.5")).status_code == 429


async def test_direct_connections_cannot_claim_another_ip() -> None:
    # 公网直接连进来的人（不经代理）自己写 X-Forwarded-For，服务器不认
    async with connect(served(DOCKER_RANGES), ("198.51.100.77", 4000)) as direct:
        response = await login_as(direct, "203.0.113.5")
    assert response.json() == {"ip": "198.51.100.77"}
