"""用例层的错误：带错误码、HTTP 状态和附带字段，由 api 层统一转成 problem+json。"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    status: int = 400
    code: str = "BAD_REQUEST"

    def __init__(
        self,
        title: str,
        *,
        code: str | None = None,
        status: int | None = None,
        retryable: bool = False,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ) -> None:
        super().__init__(title)
        self.title = title
        if code is not None:
            self.code = code
        if status is not None:
            self.status = status
        self.retryable = retryable
        self.headers = headers or {}
        self.extra = extra


class NotFound(AppError):
    status = 404
    code = "NOT_FOUND"

    def __init__(self, title: str = "资源不存在") -> None:
        super().__init__(title)


class Unauthenticated(AppError):
    status = 401
    code = "UNAUTHENTICATED"

    def __init__(self, title: str = "需要登录", **extra: Any) -> None:
        super().__init__(title, **extra)


class Conflict(AppError):
    status = 409
    code = "CONFLICT"


class Invalid(AppError):
    status = 422
    code = "VALIDATION_ERROR"


class RateLimited(AppError):
    status = 429
    code = "RATE_LIMITED"

    def __init__(self, retry_after: float) -> None:
        seconds = max(int(retry_after + 0.999), 1)
        super().__init__(
            "请求太频繁，请稍后再试",
            retryable=True,
            headers={"Retry-After": str(seconds)},
            retry_after=seconds,
        )


class Unavailable(AppError):
    status = 503
    code = "UNAVAILABLE"
