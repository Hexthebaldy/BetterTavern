"""账户与令牌：注册、登录、刷新令牌轮换与盗用检测、退出（真实 Postgres）。"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.services.auth_service import AuthService
from bettertavern.services.errors import AppError, Conflict, Invalid, Unauthenticated
from tests.support.pg import database_url, schema_engine

pytestmark = [pytest.mark.integration, pytest.mark.anyio]

URL = database_url()
if not URL:
    pytest.skip("没有设置 BT_TEST_DATABASE_URL", allow_module_level=True)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    assert URL is not None
    async with schema_engine(URL) as engine:
        yield engine


def service(engine: AsyncEngine) -> AuthService:
    return AuthService(engine, AccessTokenSigner(b"k" * 40, ttl_s=900), refresh_ttl_s=3600)


async def test_register_login_and_validation(engine: AsyncEngine) -> None:
    auth = service(engine)
    user, tokens = await auth.register("Lin@Example.com", "correct horse", "林川")
    assert auth.authenticate(tokens.access_token) == user.id
    with pytest.raises(Conflict) as taken:
        await auth.register("lin@example.COM", "another password")
    assert taken.value.code == "EMAIL_TAKEN"
    with pytest.raises(Invalid):
        await auth.register("not-an-email", "correct horse")
    with pytest.raises(Invalid):
        await auth.register("a@b.cd", "short")
    again, _ = await auth.login(" lin@example.com ", "correct horse")
    assert again.id == user.id and again.display_name == "林川"
    for email, password in [("lin@example.com", "wrong horse"), ("nobody@example.com", "x" * 9)]:
        with pytest.raises(Unauthenticated) as bad:
            await auth.login(email, password)
        assert bad.value.code == "INVALID_CREDENTIALS"


async def test_refresh_rotation_and_reuse_detection(engine: AsyncEngine) -> None:
    auth = service(engine)
    _, first = await auth.register("lin@example.com", "correct horse")
    _, second = await auth.refresh(first.refresh_token)
    assert second.refresh_token != first.refresh_token
    # 刚用过的令牌在宽限期内再用一次（响应丢了、客户端重试）是允许的
    _, retried = await auth.refresh(first.refresh_token)
    # 超过宽限期再出现：视为被盗，整族吊销，连刚发出去的新令牌也失效
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE refresh_tokens SET used_at = now() - interval '1 hour'"))
    with pytest.raises(Unauthenticated) as reused:
        await auth.refresh(first.refresh_token)
    assert reused.value.code == "REFRESH_REUSED"
    for token in (second.refresh_token, retried.refresh_token):
        with pytest.raises(Unauthenticated):
            await auth.refresh(token)


async def test_logout_revokes_the_family(engine: AsyncEngine) -> None:
    auth = service(engine)
    _, tokens = await auth.register("lin@example.com", "correct horse")
    _, rotated = await auth.refresh(tokens.refresh_token)
    await auth.logout(rotated.refresh_token)
    with pytest.raises(Unauthenticated):
        await auth.refresh(rotated.refresh_token)
    with pytest.raises(Unauthenticated):
        await auth.refresh("rt_made_up")


async def test_delete_account_needs_password(engine: AsyncEngine) -> None:
    auth = service(engine)
    user, _ = await auth.register("lin@example.com", "correct horse")
    with pytest.raises(AppError):
        await auth.delete_account(user.id, "wrong")
    await auth.delete_account(user.id, "correct horse")
    with pytest.raises(Unauthenticated):
        await auth.login("lin@example.com", "correct horse")
