"""错误响应统一用 RFC 9457 的 application/problem+json。"""

from __future__ import annotations

from typing import Any

from starlette.responses import JSONResponse


def problem(status: int, code: str, title: str, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"/errors/{code.lower().replace('_', '-')}",
        "title": title,
        "status": status,
        "code": code,
    }
    body.update(extra)
    return JSONResponse(body, status_code=status, media_type="application/problem+json")
