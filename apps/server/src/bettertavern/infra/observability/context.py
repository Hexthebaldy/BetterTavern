"""日志上下文里的编号。

- request_id：一次 HTTP 请求的单号。客户端在 X-Request-ID 里带上（App 每个请求生成一个），
  格式不对或没带时服务端生成。
- user_ref：用户的代号，由用户 id 做 SHA-256 取前 12 位，日志里不直接出现用户 id 和邮箱。
- playthrough_id、turn_id、job_id：在开始处理一个故事、回合、后台任务时绑定。

绑定用 structlog.contextvars：同一个请求或任务里之后打的每一条日志都自动带上；在请求里启动的后台任务
（例如回合生成）会继承启动时的上下文，所以回合的日志也带着提交它的那次请求的单号。
"""

from __future__ import annotations

import hashlib
import re
import uuid

import structlog

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")


def accept_request_id(candidate: str | None) -> str:
    """客户端给的单号格式没问题就用它，否则生成一个"""
    if candidate and _REQUEST_ID.match(candidate):
        return candidate
    return uuid.uuid4().hex


def user_ref(user_id: str) -> str:
    return "u_" + hashlib.sha256(user_id.encode()).hexdigest()[:12]


def bind_user(user_id: str) -> None:
    structlog.contextvars.bind_contextvars(user_ref=user_ref(user_id))


def current_request_id() -> str | None:
    value = structlog.contextvars.get_contextvars().get("request_id")
    return value if isinstance(value, str) else None
