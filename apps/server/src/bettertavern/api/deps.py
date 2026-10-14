"""依赖注入：服务容器、当前用户、限流。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request

from bettertavern.services.container import Services
from bettertavern.services.errors import RateLimited, Unauthenticated

from .ratelimit import RateLimiter


@dataclass
class Limiters:
    auth: RateLimiter
    turns: RateLimiter
    probe: RateLimiter


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_limiters(request: Request) -> Limiters:
    return request.app.state.limiters


ServicesDep = Annotated[Services, Depends(get_services)]
LimitersDep = Annotated[Limiters, Depends(get_limiters)]


def current_user(
    services: ServicesDep,
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization:
        raise Unauthenticated()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthenticated("Authorization 头格式不对")
    return services.auth.authenticate(token.strip())


UserId = Annotated[str, Depends(current_user)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check_rate(limiter: RateLimiter, key: str) -> None:
    wait = limiter.hit(key)
    if wait is not None:
        raise RateLimited(wait)
