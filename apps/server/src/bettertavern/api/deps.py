"""依赖注入：服务容器、当前用户、限流。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, Request

from bettertavern.infra.observability.context import bind_user
from bettertavern.infra.ratelimit import RateLimiter
from bettertavern.services.container import Services
from bettertavern.services.errors import RateLimited, Unauthenticated
from bettertavern.settings import Settings


@dataclass
class Limiters:
    auth: RateLimiter  # 注册、登录、验证码、找回密码，按 IP
    turns: RateLimiter  # 提交行动，按用户
    probe: RateLimiter  # 测试模型连接，按用户
    workbench: RateLimiter  # 工作台里会花钱、占地方的操作，按用户
    mail: RateLimiter  # 发验证码，按 IP（一小时）


def get_services(request: Request) -> Services:
    return request.app.state.services


def get_limiters(request: Request) -> Limiters:
    return request.app.state.limiters


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


ServicesDep = Annotated[Services, Depends(get_services)]
LimitersDep = Annotated[Limiters, Depends(get_limiters)]
SettingsDep = Annotated[Settings, Depends(get_settings)]


# async：同步的依赖会放到线程池里跑，那里绑定的日志上下文（用户代号）带不回请求本身
async def current_user(
    services: ServicesDep,
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization:
        raise Unauthenticated()
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthenticated("Malformed Authorization header")
    user_id = services.auth.authenticate(token.strip())
    bind_user(user_id)
    return user_id


UserId = Annotated[str, Depends(current_user)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check_rate(limiter: RateLimiter, key: str) -> None:
    wait = limiter.hit(key)
    if wait is not None:
        raise RateLimited(wait)
