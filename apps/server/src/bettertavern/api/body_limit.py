"""请求体大小限制（ASGI 中间件）。

FastAPI 在调用接口函数之前就会把请求体整个读进来（multipart 文件还会落到临时文件），
所以大小检查必须放在这一层：Content-Length 超限直接 413；没有 Content-Length（分块上传）
就边收边数，超限时中止读取。
"""

from __future__ import annotations

from collections.abc import Mapping

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import problem

DEFAULT_LIMIT = 1024 * 1024


class BodySizeLimit:
    def __init__(
        self, app: ASGIApp, *, default: int = DEFAULT_LIMIT, limits: Mapping[str, int] | None = None
    ) -> None:
        self.app = app
        self.default = default
        self.limits = dict(limits or {})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            await self.app(scope, receive, send)
            return
        limit = self.limits.get(scope["path"], self.default)
        declared = _content_length(scope)
        if declared is not None and declared > limit:
            response = problem(413, "PAYLOAD_TOO_LARGE", _title(limit), retryable=False)
            await response(scope, receive, send)
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI 会原样抛出 HTTPException，由错误处理转成 problem+json
                    raise HTTPException(413, _title(limit))
            return message

        await self.app(scope, limited_receive, send)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _title(limit: int) -> str:
    if limit >= 1024 * 1024:
        return f"请求体超过 {limit // (1024 * 1024)} MB"
    return f"请求体超过 {max(limit // 1024, 1)} KB"
