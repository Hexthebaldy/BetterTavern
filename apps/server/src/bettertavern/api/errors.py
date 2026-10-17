"""错误响应统一用 RFC 9457 的 application/problem+json。每个错误响应都带 request_id（请求单号），
方便对照日志。"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from bettertavern.infra.observability.context import current_request_id
from bettertavern.services.errors import AppError

log = structlog.get_logger(__name__)


def problem(
    status: int,
    code: str,
    title: str,
    *,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"/errors/{code.lower().replace('_', '-')}",
        "title": title,
        "status": status,
        "code": code,
    }
    body.update(extra)
    request_id = current_request_id()
    if request_id is not None:
        body["request_id"] = request_id
    return JSONResponse(
        body, status_code=status, media_type="application/problem+json", headers=headers
    )


_HTTP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    413: "PAYLOAD_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
}


def install_error_handlers(app: FastAPI) -> None:
    # 错误码记进日志上下文：这次请求的访问日志（http.request）里就能看到 error_code
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        structlog.contextvars.bind_contextvars(error_code=exc.code)
        return problem(
            exc.status,
            exc.code,
            exc.title,
            headers=exc.headers or None,
            retryable=exc.retryable,
            **exc.extra,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(p) for p in err.get("loc", ())], "msg": str(err.get("msg", ""))}
            for err in exc.errors()[:20]
        ]
        structlog.contextvars.bind_contextvars(
            error_code="VALIDATION_ERROR", invalid_fields=[".".join(e["loc"]) for e in errors]
        )
        return problem(
            422, "VALIDATION_ERROR", "Invalid request parameters", retryable=False, errors=errors
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "HTTP_ERROR")
        title = exc.detail if isinstance(exc.detail, str) else code
        structlog.contextvars.bind_contextvars(error_code=code)
        return problem(exc.status_code, code, title, retryable=False)

    # 正常情况下未处理的异常由最外层的 RequestContext 接住；
    # 这里是没有装它时（例如单独测某个中间件）的兜底
    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.error("http.error", method=request.method, path=request.url.path, exc_info=exc)
        return problem(500, "INTERNAL_ERROR", "Internal server error", retryable=True)
