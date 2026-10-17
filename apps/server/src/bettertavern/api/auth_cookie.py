"""网页端的登录态：刷新令牌放在 HttpOnly Cookie 里，页面脚本读不到；
访问令牌照常在响应体里，网页只放在内存中。

请求带 `X-Auth-Mode: cookie` 时，注册、登录、刷新、退出走这一套；
不带时和手机端一样，刷新令牌在请求体和响应体里。
Cookie 只发往 /v1/auth（Path），SameSite=Strict，别的网站发起的请求不会带上它。另外两道防线：
自定义请求头让跨域请求必须先过 CORS 预检；
浏览器的 Sec-Fetch-Site 不是同源时，Origin 必须在 CORS_ORIGINS 里。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import Cookie, Header, Request, Response

from bettertavern.services.auth_service import TokenPair
from bettertavern.services.errors import AppError, Invalid
from bettertavern.settings import Settings

REFRESH_COOKIE = "bt_refresh"
COOKIE_PATH = "/v1/auth"

AuthMode = Annotated[str | None, Header(alias="X-Auth-Mode")]
RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE, max_length=200)]

_SAME_ORIGIN = ("same-origin", "none")


class CrossSite(AppError):
    status = 403
    code = "CROSS_SITE"

    def __init__(self) -> None:
        super().__init__("Sign-in requests from other sites aren't accepted")


def cookie_mode(request: Request, mode: str | None, settings: Settings) -> bool:
    """这次请求是不是 Cookie 模式；是的话先确认请求来自同一个网站。"""
    if mode is None:
        return False
    if mode.strip().lower() != "cookie":
        raise Invalid("X-Auth-Mode can only be cookie", field="X-Auth-Mode")
    site = request.headers.get("sec-fetch-site")
    if site is not None and site not in _SAME_ORIGIN:
        origin = request.headers.get("origin")
        if origin is None or origin not in settings.cors_origin_list:
            raise CrossSite()
    return True


def _cookie_header(settings: Settings, value: str, max_age: int) -> str:
    holder = Response()
    holder.set_cookie(
        REFRESH_COOKIE,
        value,
        max_age=max_age,
        path=COOKIE_PATH,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite="strict",
    )
    return holder.headers["set-cookie"]


def set_refresh_cookie(response: Response, tokens: TokenPair, settings: Settings) -> None:
    left = (tokens.refresh_expires_at - datetime.now(UTC)).total_seconds()
    response.headers.append(
        "set-cookie", _cookie_header(settings, tokens.refresh_token, max(int(left), 0))
    )


def clearing_cookie(settings: Settings) -> str:
    """让浏览器删掉刷新令牌的 Set-Cookie 头（退出、刷新被拒时）。"""
    return _cookie_header(settings, "", 0)
