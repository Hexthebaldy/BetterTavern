"""每个 HTTP 请求的上下文（ASGI 中间件，放在最外层）：请求单号、访问日志、未处理的异常。

- 请求单号：客户端在 X-Request-ID 里带上（App 每个请求生成一个），格式不对或没带时服务端生成。
  响应头原样带回 X-Request-ID，错误响应体里也有 request_id。单号绑定到日志上下文，
  这次请求里打的每一条日志都带着它，在请求里启动的后台任务（回合生成）也会继承它。
- 访问日志：请求结束时记一条 http.request（方法、路径、路由模板、状态码、耗时、客户端版本）。
  事件流这种长连接在连接结束时才记，耗时就是连接持续的时间。健康检查成功时不记，免得刷屏。
- 未处理的异常：记 http.error（带堆栈），还没开始响应时返回 500 INTERNAL_ERROR；
  响应已经开始（事件流中途出错）就只能记下来，连接由服务器关掉。
"""

from __future__ import annotations

import time

import structlog
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from bettertavern.infra.observability.context import accept_request_id

from .errors import problem

log = structlog.get_logger(__name__)

HEADER = "X-Request-ID"
_QUIET_PATHS = frozenset({"/health", "/ready"})


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", ()):
        if key == name:
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None


class RequestContext:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = accept_request_id(_header(scope, b"x-request-id"))
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status: int | None = None

        async def send_with_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message).append(HEADER, request_id)
            await send(message)

        with structlog.contextvars.bound_contextvars(request_id=request_id):
            try:
                await self.app(scope, receive, send_with_id)
            except Exception:
                log.exception("http.error", method=scope["method"], path=scope["path"])
                if status is None:
                    response = problem(500, "INTERNAL_ERROR", "服务端出错了", retryable=True)
                    await response(scope, receive, send_with_id)
            finally:
                self._access_log(scope, status, started)

    @staticmethod
    def _access_log(scope: Scope, status: int | None, started: float) -> None:
        if scope["path"] in _QUIET_PATHS and status is not None and status < 400:
            return
        route = scope.get("route")
        fields = {
            "method": scope["method"],
            "path": scope["path"],
            "route": getattr(route, "path", None),
            "status": status,
            "duration_ms": round((time.perf_counter() - started) * 1000),
            "client_version": _header(scope, b"x-client-version"),
        }
        if status is None:
            # 客户端在响应开始前就断开了
            log.info("http.request", aborted=True, **fields)
        elif status >= 500:
            log.warning("http.request", **fields)
        else:
            log.info("http.request", **fields)
