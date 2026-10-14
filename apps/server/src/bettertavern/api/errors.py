"""错误响应统一用 RFC 9457 的 application/problem+json。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from bettertavern.services.errors import AppError

log = logging.getLogger(__name__)


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
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
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
        return problem(422, "VALIDATION_ERROR", "请求参数不正确", retryable=False, errors=errors)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "HTTP_ERROR")
        title = exc.detail if isinstance(exc.detail, str) else code
        return problem(exc.status_code, code, title, retryable=False)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception) -> JSONResponse:
        log.exception("未处理的异常：%s %s", request.method, request.url.path)
        return problem(500, "INTERNAL_ERROR", "服务端出错了", retryable=True)
