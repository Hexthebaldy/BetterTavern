"""认证：注册、登录、刷新、退出；当前账户。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Request, Response, status

from bettertavern.api.deps import LimitersDep, ServicesDep, UserId, check_rate, client_ip
from bettertavern.api.schemas.auth import (
    AuthOut,
    DeleteAccountIn,
    LoginIn,
    RefreshIn,
    RegisterIn,
    UserOut,
)
from bettertavern.services.auth_service import TokenPair, UserView

router = APIRouter(prefix="/v1", tags=["认证"])

UserAgent = Annotated[str | None, Header()]


def _auth_out(user: UserView, tokens: TokenPair) -> AuthOut:
    return AuthOut(
        user=UserOut.model_validate(user),
        access_token=tokens.access_token,
        token_type=tokens.token_type,
        expires_in=tokens.expires_in,
        refresh_token=tokens.refresh_token,
        refresh_expires_at=tokens.refresh_expires_at,
    )


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterIn,
    request: Request,
    services: ServicesDep,
    limiters: LimitersDep,
    user_agent: UserAgent = None,
) -> AuthOut:
    check_rate(limiters.auth, f"register:{client_ip(request)}")
    user, tokens = await services.auth.register(
        body.email, body.password, body.display_name, user_agent
    )
    return _auth_out(user, tokens)


@router.post("/auth/login")
async def login(
    body: LoginIn,
    request: Request,
    services: ServicesDep,
    limiters: LimitersDep,
    user_agent: UserAgent = None,
) -> AuthOut:
    check_rate(limiters.auth, f"login:{client_ip(request)}")
    user, tokens = await services.auth.login(body.email, body.password, user_agent)
    return _auth_out(user, tokens)


@router.post("/auth/refresh")
async def refresh(body: RefreshIn, services: ServicesDep, user_agent: UserAgent = None) -> AuthOut:
    user, tokens = await services.auth.refresh(body.refresh_token, user_agent)
    return _auth_out(user, tokens)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshIn, services: ServicesDep) -> Response:
    await services.auth.logout(body.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", tags=["账户"])
async def me(user_id: UserId, services: ServicesDep) -> UserOut:
    return UserOut.model_validate(await services.auth.get_user(user_id))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT, tags=["账户"])
async def delete_me(body: DeleteAccountIn, user_id: UserId, services: ServicesDep) -> Response:
    await services.auth.delete_account(user_id, body.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
