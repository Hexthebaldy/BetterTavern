"""认证：注册、邮箱验证码、登录、刷新、退出、找回密码；当前账户、修改密码。

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
    ChangePasswordIn,
    DeleteAccountIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    RegisterOut,
    ResetPasswordIn,
    SendCodeIn,
    UserOut,
    VerifyEmailIn,
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
) -> RegisterOut:
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"register:{client_ip(request)}")
    user, tokens = await services.auth.register(
        body.email, body.password, body.display_name, user_agent, body.locale
    )
    if tokens is None:
        return RegisterOut(user=UserOut.model_validate(user), verification_required=True)
    out = _auth_out(response, user, tokens, cookie, settings)
    return RegisterOut(verification_required=False, **out.model_dump())


@router.post("/auth/send-code", status_code=status.HTTP_204_NO_CONTENT)
async def send_code(
    body: SendCodeIn, request: Request, services: ServicesDep, limiters: LimitersDep
) -> Response:
    """重发注册验证码、找回密码。邮箱没注册过时也返回 204（不透露邮箱是否注册过）。"""
    check_rate(limiters.mail, f"mail:{client_ip(request)}")
    await services.auth.send_code(body.email, body.purpose, body.locale)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/auth/verify-email")
async def verify_email(
    body: VerifyEmailIn,
    request: Request,
    response: Response,
    services: ServicesDep,
    limiters: LimitersDep,
    settings: SettingsDep,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
) -> AuthOut:
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"code:{client_ip(request)}")
    user, tokens = await services.auth.verify_email(body.email, body.code, user_agent)
    return _auth_out(response, user, tokens, cookie, settings)


@router.post("/auth/reset-password")
async def reset_password(
    body: ResetPasswordIn,
    request: Request,
    response: Response,
    services: ServicesDep,
    limiters: LimitersDep,
    settings: SettingsDep,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
) -> AuthOut:
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"code:{client_ip(request)}")
    user, tokens = await services.auth.reset_password(
        body.email, body.code, body.new_password, user_agent
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


@router.post("/me/password", tags=["account"])
async def change_password(
    body: ChangePasswordIn,
    request: Request,
    response: Response,
    user_id: UserId,
    services: ServicesDep,
    limiters: LimitersDep,
    settings: SettingsDep,
    user_agent: UserAgent = None,
    auth_mode: AuthMode = None,
) -> AuthOut:
    """改密码：其他设备上的登录都退出，这台设备拿到一组新令牌。"""
    cookie = cookie_mode(request, auth_mode, settings)
    check_rate(limiters.auth, f"password:{user_id}")
    user, tokens = await services.auth.change_password(
        user_id, body.current_password, body.new_password, user_agent
    )
    return _auth_out(response, user, tokens, cookie, settings)
