"""认证：注册、登录、刷新、退出；当前账户。

带 `X-Auth-Mode: cookie` 的请求（网页端）把刷新令牌放在 HttpOnly Cookie 里，见 api/auth_cookie.py。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request, Response, status

from bettertavern.api.auth_cookie import (
    AuthMode,
    RefreshCookie,
    clearing_cookie,
    cookie_mode,
    set_refresh_cookie,
)
from bettertavern.api.deps import (
    LimitersDep,
    ServicesDep,
    SettingsDep,
    UserId,
    check_rate,
    client_ip,
)
from bettertavern.api.schemas.auth import (
    AuthOut,
    DeleteAccountIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    UserOut,
)
from bettertavern.services.auth_service import TokenPair, UserView
from bettertavern.services.errors import AppError, Invalid, Unauthenticated
from bettertavern.settings import Settings

router = APIRouter(prefix="/v1", tags=["auth"])

UserAgent = Annotated[str | None, Header()]


def _auth_out(
    response: Response, user: UserView, tokens: TokenPair, cookie: bool, settings: Settings
) -> AuthOut:
    if cookie:
        set_refresh_cookie(response, tokens, settings)
    return AuthOut(
        user=UserOut.model_validate(user),
        access_token=tokens.access_token,
        token_type=tokens.token_type,
        expires_in=tokens.expires_in,
        refresh_token=None if cookie else tokens.refresh_token,
        refresh_expires_at=tokens.refresh_expires_at,
    )


def _refresh_token(cookie: bool, body: RefreshIn | None, from_cookie: str | None) -> str | None:
    """Cookie 模式只认 Cookie；否则刷新令牌必须在请求体里。"""
    if cookie:
        return from_cookie or None
    if body is None:
        raise Invalid("Missing refresh token", field="refresh_token")
    return body.refresh_token


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    request: Request,
    response: Response,
    services: ServicesDep,
    limiters: LimitersDep,
    settings: SettingsDep,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
) -> AuthOut:
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"register:{client_ip(request)}")
    user, tokens = await services.auth.register(
        body.email, body.password, body.display_name, user_agent
    )
    return _auth_out(response, user, tokens, cookie, settings)


@router.post("/auth/login")
async def login(
    body: LoginIn,
    request: Request,
    response: Response,
    services: ServicesDep,
    limiters: LimitersDep,
    settings: SettingsDep,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
) -> AuthOut:
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"login:{client_ip(request)}")
    user, tokens = await services.auth.login(body.email, body.password, user_agent)
    return _auth_out(response, user, tokens, cookie, settings)


@router.post("/auth/refresh")
async def refresh(
    request: Request,
    response: Response,
    services: ServicesDep,
    settings: SettingsDep,
    body: RefreshIn | None = None,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
    refresh_cookie: RefreshCookie = None,
) -> AuthOut:
    cookie = cookie_mode(request, auth_mode, settings)
    token = _refresh_token(cookie, body, refresh_cookie)
    try:
        if token is None:
            raise Unauthenticated("Session expired, please sign in again", code="REFRESH_INVALID")
        user, tokens = await services.auth.refresh(token, user_agent)
    except AppError as exc:
        # 刷新被拒：让浏览器删掉没用的 Cookie，下次打开网页直接去登录页
        if cookie and exc.status == status.HTTP_401_UNAUTHORIZED:
            exc.headers["set-cookie"] = clearing_cookie(settings)
        raise
    return _auth_out(response, user, tokens, cookie, settings)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    services: ServicesDep,
    settings: SettingsDep,
    body: RefreshIn | None = None,
    auth_mode: AuthMode = None,
    refresh_cookie: RefreshCookie = None,
) -> Response:
    cookie = cookie_mode(request, auth_mode, settings)
    token = _refresh_token(cookie, body, refresh_cookie)
    if token is not None:
        await services.auth.logout(token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if cookie:
        response.headers.append("set-cookie", clearing_cookie(settings))
    return response


@router.get("/me", tags=["account"])
async def me(user_id: UserId, services: ServicesDep) -> UserOut:
    return UserOut.model_validate(await services.auth.get_user(user_id))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, tags=["account"])
async def delete_me(body: DeleteAccountIn, user_id: UserId, services: ServicesDep) -> Response:
    await services.auth.delete_account(user_id, body.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
