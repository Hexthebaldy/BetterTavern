from __future__ import annotations

import ipaddress
from collections.abc import Sequence

import httpx
import pytest

from bettertavern.providers.errors import EndpointNotAllowed
from bettertavern.providers.transport import (
    EndpointPolicy,
    IPAddress,
    build_http_client,
    check_url,
    ip_is_public,
    resolve_and_check,
    validate_endpoint,
)
from tests.fakes.llm_server import RunningFakeLLM

pytestmark = pytest.mark.anyio

STRICT = EndpointPolicy(allow_private=False)
LENIENT = EndpointPolicy(allow_private=True)


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # 云厂商元数据
        "100.100.100.200",  # CGNAT 段里的元数据地址
        "0.0.0.0",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::1",
        "::",
        "fd00:ec2::254",
        "fe80::1",
        "::ffff:127.0.0.1",  # IPv4 映射
        "2002:7f00:1::",  # 6to4 里嵌了 127.0.0.1
        "64:ff9b::a00:1",  # NAT64 里嵌了 10.0.0.1
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",  # Teredo
    ],
)
def test_private_and_special_addresses_are_blocked(address: str) -> None:
    assert not ip_is_public(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    "address", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808"]
)
def test_public_addresses_are_allowed(address: str) -> None:
    assert ip_is_public(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("http://api.example.com/v1", "https"),
        ("ftp://api.example.com", "https"),
        ("https://user:pw@api.example.com", "user name"),
        ("https://127.0.0.1/v1", "Private or reserved"),
        ("https://[::1]/v1", "Private or reserved"),
        ("https://localhost:8080/v1", "localhost"),
        ("https://foo.localhost/v1", "localhost"),
        ("not a url", "https"),
    ],
)
def test_check_url_rejects(url: str, reason: str) -> None:
    with pytest.raises(EndpointNotAllowed, match=reason):
        check_url(url, STRICT)


def test_check_url_lenient_allows_http_and_private() -> None:
    assert check_url("http://127.0.0.1:11434/v1", LENIENT).host == "127.0.0.1"


def fake_resolver(table: dict[str, Sequence[str]]):
    async def resolve(host: str, port: int) -> list[IPAddress]:
        if host not in table:
            raise OSError("no such host")
        return [ipaddress.ip_address(a) for a in table[host]]

    return resolve


async def test_any_private_resolution_rejects_whole_host() -> None:
    resolver = fake_resolver({"rebind.example": ["93.184.216.34", "127.0.0.1"]})
    with pytest.raises(EndpointNotAllowed, match=r"127\.0\.0\.1"):
        await resolve_and_check("rebind.example", 443, STRICT, resolver)
    ips = await resolve_and_check("rebind.example", 443, LENIENT, resolver)
    assert len(ips) == 2


async def test_validate_endpoint_reports_dns_failure_as_not_allowed() -> None:
    with pytest.raises(EndpointNotAllowed, match="resolve"):
        await validate_endpoint("https://nowhere.example/v1", STRICT, fake_resolver({}))


async def test_strict_client_never_connects_to_private_ip(fake_llm: RunningFakeLLM) -> None:
    # 主机名解析到 127.0.0.1：连接阶段必须被拒绝，假服务收不到任何请求
    resolver = fake_resolver({"evil.example": ["127.0.0.1"]})
    async with build_http_client(STRICT, resolver=resolver) as client:
        with pytest.raises(EndpointNotAllowed):
            await client.get(f"https://evil.example:{fake_llm.port}/v1/models")
        with pytest.raises(EndpointNotAllowed, match="https"):
            await client.get(f"{fake_llm.base_url}/models")
    assert fake_llm.app.requests == []


async def test_pinned_ip_keeps_original_host_header(fake_llm: RunningFakeLLM) -> None:
    resolver = fake_resolver({"llm.example": ["127.0.0.1"]})
    async with build_http_client(LENIENT, resolver=resolver) as client:
        response = await client.get(f"http://llm.example:{fake_llm.port}/v1/models")
    assert response.status_code == 200
    assert fake_llm.app.requests[-1].headers["host"] == f"llm.example:{fake_llm.port}"


async def test_dns_failure_at_connect_time_is_a_connection_error() -> None:
    async with build_http_client(LENIENT, resolver=fake_resolver({})) as client:
        with pytest.raises(httpx.ConnectError):
            await client.get("http://missing.example/v1/models")


async def test_redirects_are_not_followed(fake_llm: RunningFakeLLM) -> None:
    from tests.fakes.llm_server import JsonReply

    fake_llm.app.push(JsonReply({}, status=302, headers={"location": "http://169.254.169.254/"}))
    async with build_http_client(LENIENT) as client:
        response = await client.post(f"{fake_llm.base_url}/chat/completions", json={})
    assert response.status_code == 302
    assert len(fake_llm.app.requests) == 1
