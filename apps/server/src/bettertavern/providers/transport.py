"""出站请求的 SSRF 防护。

用户可以填任意端点，所以所有出站请求都要过 SafeTransport：
- 只允许 https；ALLOW_PRIVATE_ENDPOINTS 打开时才允许 http 和私网地址；
- 先解析 DNS，任何一个解析结果落在回环、私网、链路本地、组播、保留段、云元数据地址
  （以及嵌在 IPv6 里的这类 IPv4）就拒绝整个请求；
- 通过校验的 IP 被“钉住”：直接连这个 IP，TLS 的 SNI 和 Host 仍用原域名，
  防止校验和连接之间 DNS 被改写；
- 不跟随重定向。
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
from collections.abc import Awaitable, Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, cast

import httpcore
import httpx

from .errors import EndpointNotAllowed

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[Sequence[IPAddress]]]

_NAT64 = ipaddress.IPv6Network("64:ff9b::/96")

DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
DEFAULT_LIMITS = httpx.Limits(
    max_connections=100, max_keepalive_connections=20, keepalive_expiry=30.0
)


@dataclass(frozen=True, slots=True)
class EndpointPolicy:
    # 自己部署的人想接本机的 Ollama 可以打开；多人共用的公开服务永远不要开
    allow_private: bool = False
    # 当作外网放行的“假 IP 段”：本机开 Clash fake-ip 这类代理时，域名会解析到 198.18.0.0/15
    # 这样的保留地址，写在这里就不必为了联网把整个内网都打开（FAKE_IP_RANGES）
    fake_ip_ranges: tuple[str, ...] = ()

    def allows(self, ip: IPAddress) -> bool:
        if self.allow_private or ip_is_public(ip):
            return True
        return any(ip in ipaddress.ip_network(net, strict=False) for net in self.fake_ip_ranges)


def ip_is_public(ip: IPAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return ip_is_public(ip.ipv4_mapped)
        if ip.sixtofour is not None:
            return ip_is_public(ip.sixtofour)
        if ip.teredo is not None:
            return False
        if ip in _NAT64:
            return ip_is_public(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF))
    if (
        ip.is_multicast
        or ip.is_unspecified
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_private
        or ip.is_reserved
    ):
        return False
    return ip.is_global


def check_url(url: str, policy: EndpointPolicy) -> httpx.URL:
    """静态检查：协议、主机、端口、不带用户信息；主机是 IP 字面量时直接检查地址。"""
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError) as exc:
        raise EndpointNotAllowed(f"Can't parse the URL: {exc}") from exc
    if parsed.scheme not in ("https", "http"):
        raise EndpointNotAllowed("Only https endpoints are supported")
    if parsed.scheme == "http" and not policy.allow_private:
        raise EndpointNotAllowed(
            "Only https endpoints are supported "
            "(self-hosted servers can set ALLOW_PRIVATE_ENDPOINTS)"
        )
    if not parsed.host:
        raise EndpointNotAllowed("The URL has no host name")
    if parsed.userinfo:
        raise EndpointNotAllowed("The URL can't contain a user name or password")
    if not policy.allow_private:
        try:
            literal = ipaddress.ip_address(parsed.host)
        except ValueError:
            literal = None
        if literal is not None and not policy.allows(literal):
            raise EndpointNotAllowed(f"Private or reserved addresses aren't allowed: {literal}")
        if parsed.host.lower() in (
            "localhost",
            "localhost.localdomain",
        ) or parsed.host.lower().endswith(".localhost"):
            raise EndpointNotAllowed("localhost isn't allowed")
    return parsed


async def system_resolver(host: str, port: int) -> list[IPAddress]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    seen: list[IPAddress] = []
    for _family, _type, _proto, _canon, sockaddr in infos:
        ip = ipaddress.ip_address(str(sockaddr[0]).split("%", 1)[0])
        if ip not in seen:
            seen.append(ip)
    return seen


class HostResolutionError(OSError):
    """DNS 解析失败。连接时按连接错误处理（可重试），保存凭据时按端点不可用处理。"""


async def resolve_and_check(
    host: str, port: int, policy: EndpointPolicy, resolver: Resolver = system_resolver
) -> list[IPAddress]:
    try:
        ips = list(await resolver(host, port))
    except OSError as exc:
        raise HostResolutionError(f"Can't resolve host {host}: {exc}") from exc
    if not ips:
        raise HostResolutionError(f"Host {host} has no addresses")
    if not policy.allow_private:
        blocked = [str(ip) for ip in ips if not policy.allows(ip)]
        if blocked:
            raise EndpointNotAllowed(
                f"Host {host} resolves to private or reserved addresses: {', '.join(blocked)}"
            )
    return ips


async def validate_endpoint(
    url: str, policy: EndpointPolicy, resolver: Resolver = system_resolver
) -> None:
    """创建或修改凭据时调用：早失败，给出清楚的错误。"""
    parsed = check_url(url, policy)
    try:
        await resolve_and_check(parsed.host, _port(parsed), policy, resolver)
    except HostResolutionError as exc:
        raise EndpointNotAllowed(str(exc)) from exc


def _port(url: httpx.URL) -> int:
    return url.port or (443 if url.scheme == "https" else 80)


class SafeNetworkBackend(httpcore.AsyncNetworkBackend):
    """解析、校验、钉住 IP 之后再连接。TLS 握手由 httpcore 用原主机名完成。"""

    def __init__(
        self,
        policy: EndpointPolicy,
        *,
        resolver: Resolver = system_resolver,
        inner: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self._policy = policy
        self._resolver = resolver
        # httpcore 在没装 anyio 时导出一个同名占位类，类型检查器会看到它，所以显式 cast
        self._inner = inner or cast(httpcore.AsyncNetworkBackend, httpcore.AnyIOBackend())

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            async with asyncio.timeout(timeout):
                ips = await resolve_and_check(host, port, self._policy, self._resolver)
        except TimeoutError as exc:
            raise httpcore.ConnectTimeout(f"Resolving {host} timed out") from exc
        except HostResolutionError as exc:
            raise httpcore.ConnectError(str(exc)) from exc
        last_error: Exception | None = None
        for ip in ips:
            try:
                return await self._inner.connect_tcp(
                    str(ip),
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        assert last_error is not None
        raise last_error

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise EndpointNotAllowed("Model services can't be reached through a Unix socket")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class SafeTransport(httpx.AsyncHTTPTransport):
    """httpx 传输：连接池换成带 SafeNetworkBackend 的那一个。"""

    def __init__(
        self,
        policy: EndpointPolicy,
        *,
        limits: httpx.Limits = DEFAULT_LIMITS,
        verify: ssl.SSLContext | bool = True,
        resolver: Resolver = system_resolver,
    ) -> None:
        super().__init__(verify=verify, limits=limits, trust_env=False, http2=False)
        ssl_context = (
            verify
            if isinstance(verify, ssl.SSLContext)
            else httpx.create_ssl_context(verify=verify, trust_env=False)
        )
        if not hasattr(self, "_pool"):  # pragma: no cover - httpx 内部结构变化时尽早暴露
            raise RuntimeError(
                "httpx.AsyncHTTPTransport internals changed; SafeTransport needs an update"
            )
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl_context,
            max_connections=limits.max_connections,
            max_keepalive_connections=limits.max_keepalive_connections,
            keepalive_expiry=limits.keepalive_expiry,
            http1=True,
            http2=False,
            network_backend=SafeNetworkBackend(policy, resolver=resolver),
        )
        self._policy = policy

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        # 每次请求都再查一遍协议和主机字面量；DNS 结果由 SafeNetworkBackend 在连接时校验
        check_url(str(request.url), self._policy)
        return await super().handle_async_request(request)


class ProxiedSafeTransport(httpx.AsyncBaseTransport):
    """经出站代理访问时：先在本地解析并校验目标主机，再交给代理。

    代理会自己再解析一次，所以这里做不到 IP 钉住；需要代理的部署接受这个折中。
    """

    def __init__(
        self,
        policy: EndpointPolicy,
        proxy: str,
        *,
        limits: httpx.Limits = DEFAULT_LIMITS,
        verify: ssl.SSLContext | bool = True,
        resolver: Resolver = system_resolver,
    ) -> None:
        self._policy = policy
        self._resolver = resolver
        self._inner = httpx.AsyncHTTPTransport(
            proxy=proxy, verify=verify, limits=limits, trust_env=False
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        check_url(str(request.url), self._policy)
        try:
            await resolve_and_check(
                request.url.host, _port(request.url), self._policy, self._resolver
            )
        except HostResolutionError as exc:
            raise httpx.ConnectError(str(exc), request=request) from exc
        return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        await self._inner.aclose()


def build_http_client(
    policy: EndpointPolicy,
    *,
    proxy: str | None = None,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    user_agent: str = "BetterTavern",
    resolver: Resolver = system_resolver,
    verify: ssl.SSLContext | bool = True,
) -> httpx.AsyncClient:
    transport: httpx.AsyncBaseTransport
    if proxy:
        transport = ProxiedSafeTransport(policy, proxy, resolver=resolver, verify=verify)
    else:
        transport = SafeTransport(policy, resolver=resolver, verify=verify)
    return httpx.AsyncClient(
        transport=transport,
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        headers={"User-Agent": user_agent},
    )
