"""账户与令牌：注册、登录、刷新令牌轮换与盗用检测、退出；邮箱验证码、找回和修改密码。

用真实 Postgres。
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.infra.mail.memory import MemorySender
from bettertavern.services.auth_service import AccountPolicy, AuthService, TokenPair
from bettertavern.services.errors import (
    AppError,
    Conflict,
    Invalid,
    RateLimited,
    Unauthenticated,
    Unavailable,
)
from bettertavern.services.maintenance import Maintenance
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


class Clock:
    def __init__(self) -> None:
        self.now = time.time()

    def __call__(self) -> float:
        return self.now


def verifying(
    engine: AsyncEngine, mail: MemorySender, clock: Clock | None = None, *, open_: bool = True
) -> AuthService:
    """要求验证邮箱的部署。"""
    return AuthService(
        engine,
        AccessTokenSigner(b"k" * 40, ttl_s=900),
        refresh_ttl_s=3600,
        clock=clock or time.time,
        policy=AccountPolicy(verification_required=True, registration_open=open_),
        mailer=mail,
    )


def signed_in(tokens: TokenPair | None) -> TokenPair:
    assert tokens is not None
    return tokens


def code_for(mail: MemorySender, address: str) -> str:
    sent = mail.last_to(address)
    assert sent is not None and sent.dev_code is not None
    return sent.dev_code


def wrong(code: str) -> str:
    return f"{(int(code) + 1) % 1_000_000:06d}"


async def test_register_login_and_validation(engine: AsyncEngine) -> None:
    auth = service(engine)
    user, tokens = await auth.register("Lin@Example.com", "correct horse", "林川")
    # 不要求验证邮箱：注册完直接登录，账号记为已验证
    assert auth.authenticate(signed_in(tokens).access_token) == user.id
    assert user.email_verified
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
    _, registered = await auth.register("lin@example.com", "correct horse")
    first = signed_in(registered)
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
    _, rotated = await auth.refresh(signed_in(tokens).refresh_token)
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


async def test_email_verification_flow(engine: AsyncEngine) -> None:
    mail = MemorySender()
    auth = verifying(engine, mail)
    user, tokens = await auth.register("Lin@Example.com", "correct horse", "林川", language="en")
    # 要求验证邮箱：注册不登录，验证码按注册时的语言发出去
    assert tokens is None and not user.email_verified and user.locale == "en"
    code = code_for(mail, "Lin@Example.com")
    assert code in mail.sent[-1].subject and "sign-up code" in mail.sent[-1].text
    # 没验证就登录：密码对了才告诉你要验证
    with pytest.raises(AppError) as unverified:
        await auth.login("lin@example.com", "correct horse")
    assert unverified.value.code == "EMAIL_NOT_VERIFIED"
    assert unverified.value.extra["email"] == "Lin@Example.com"
    with pytest.raises(Unauthenticated):
        await auth.login("lin@example.com", "wrong horse")
    with pytest.raises(AppError) as bad:
        await auth.verify_email("lin@example.com", wrong(code))
    assert bad.value.code == "CODE_INVALID" and bad.value.extra["attempts_left"] == 4
    verified, pair = await auth.verify_email("LIN@example.com ", code)
    assert verified.email_verified and auth.authenticate(pair.access_token) == user.id
    # 验证码用过就作废；之后正常登录
    with pytest.raises(AppError) as used:
        await auth.verify_email("lin@example.com", code)
    assert used.value.code == "CODE_EXPIRED"
    again, _ = await auth.login("lin@example.com", "correct horse")
    assert again.email_verified


async def test_codes_expire_and_burn_out(engine: AsyncEngine) -> None:
    mail = MemorySender()
    clock = Clock()
    auth = verifying(engine, mail, clock)
    await auth.register("lin@example.com", "correct horse")
    code = code_for(mail, "lin@example.com")
    # 错 5 次就作废，之后填对也不行
    for left in (4, 3, 2, 1, 0):
        with pytest.raises(AppError) as bad:
            await auth.verify_email("lin@example.com", wrong(code))
        assert bad.value.code == "CODE_INVALID" and bad.value.extra["attempts_left"] == left
    with pytest.raises(AppError) as burnt:
        await auth.verify_email("lin@example.com", code)
    assert burnt.value.code == "CODE_EXPIRED"
    # 15 分钟以后过期
    await auth.register("zhou@example.com", "correct horse")
    late = code_for(mail, "zhou@example.com")
    clock.now += 16 * 60
    with pytest.raises(AppError) as expired:
        await auth.verify_email("zhou@example.com", late)
    assert expired.value.code == "CODE_EXPIRED"
    # 没注册过的邮箱和过期一样回答
    with pytest.raises(AppError) as unknown:
        await auth.verify_email("nobody@example.com", "123456")
    assert unknown.value.code == "CODE_EXPIRED"
    with pytest.raises(Invalid):
        await auth.verify_email("lin@example.com", "12ab56")


async def test_unverified_email_can_be_claimed_again(engine: AsyncEngine) -> None:
    mail = MemorySender()
    auth = verifying(engine, mail)
    first, _ = await auth.register("lin@example.com", "someone else", "冒名")
    # 没验证的邮箱再注册：换成这次填的密码和昵称（谁能收到验证码谁算数）
    second, _ = await auth.register("lin@example.com", "correct horse", "林川")
    assert second.id == first.id and second.display_name == "林川"
    await auth.verify_email("lin@example.com", code_for(mail, "lin@example.com"))
    with pytest.raises(Unauthenticated):
        await auth.login("lin@example.com", "someone else")
    await auth.login("lin@example.com", "correct horse")
    # 验证过的邮箱不能再注册
    with pytest.raises(Conflict) as taken:
        await auth.register("lin@example.com", "correct horse")
    assert taken.value.code == "EMAIL_TAKEN"


async def test_send_code_throttles_and_hides_unknown_emails(engine: AsyncEngine) -> None:
    mail = MemorySender()
    auth = verifying(engine, mail)
    # 没注册过：什么都不发，回应和发了一样
    await auth.send_code("nobody@example.com", "reset")
    assert mail.sent == []
    await auth.register("lin@example.com", "correct horse")
    assert len(mail.sent) == 1
    # 同一个邮箱一分钟只发一封
    with pytest.raises(RateLimited):
        await auth.send_code("lin@example.com", "verify")
    with pytest.raises(Invalid):
        await auth.send_code("lin@example.com", "other")


async def test_mail_failure_is_reported(engine: AsyncEngine) -> None:
    mail = MemorySender()
    mail.fail = True
    auth = verifying(engine, mail)
    # 注册时顺带发的验证码没发出去：账号照样建好，用户可以在验证页重发
    user, tokens = await auth.register("lin@example.com", "correct horse")
    assert tokens is None and not user.email_verified
    # 用户自己点“发送验证码”时要告诉他没发出去
    await service(engine).register("zhou@example.com", "correct horse")
    with pytest.raises(Unavailable) as down:
        await auth.send_code("zhou@example.com", "reset")
    assert down.value.code == "MAIL_UNAVAILABLE" and down.value.retryable


async def test_reset_password_signs_out_everywhere(engine: AsyncEngine) -> None:
    mail = MemorySender()
    auth = service(engine)
    _, tokens = await auth.register("lin@example.com", "correct horse")
    resetting = verifying(engine, mail)
    await resetting.send_code("lin@example.com", "reset", "ja")
    code = code_for(mail, "lin@example.com")
    assert "パスワード" in mail.sent[-1].subject or "パスワード" in mail.sent[-1].text
    with pytest.raises(Invalid):
        await resetting.reset_password("lin@example.com", code, "short")
    user, fresh = await resetting.reset_password("lin@example.com", code, "new horse battery")
    assert resetting.authenticate(fresh.access_token) == user.id
    # 其他设备上的登录都退出
    with pytest.raises(Unauthenticated):
        await auth.refresh(signed_in(tokens).refresh_token)
    with pytest.raises(Unauthenticated):
        await auth.login("lin@example.com", "correct horse")
    await auth.login("lin@example.com", "new horse battery")


async def test_change_password(engine: AsyncEngine) -> None:
    auth = service(engine)
    user, laptop = await auth.register("lin@example.com", "correct horse")
    _, phone = await auth.login("lin@example.com", "correct horse")
    with pytest.raises(AppError) as bad:
        await auth.change_password(user.id, "wrong horse", "new horse battery")
    assert bad.value.code == "INVALID_CREDENTIALS"
    with pytest.raises(Invalid):
        await auth.change_password(user.id, "correct horse", "short")
    _, current = await auth.change_password(user.id, "correct horse", "new horse battery")
    # 改密码的这台设备换了新令牌，其他设备退出
    await auth.refresh(current.refresh_token)
    for old in (signed_in(laptop), phone):
        with pytest.raises(Unauthenticated):
            await auth.refresh(old.refresh_token)
    await auth.login("lin@example.com", "new horse battery")


async def test_registration_can_be_closed(engine: AsyncEngine) -> None:
    auth = verifying(engine, MemorySender(), open_=False)
    with pytest.raises(AppError) as closed:
        await auth.register("lin@example.com", "correct horse")
    assert closed.value.code == "REGISTRATION_CLOSED" and closed.value.status == 403


async def test_maintenance_purges_unverified_accounts(engine: AsyncEngine) -> None:
    mail = MemorySender()
    auth = verifying(engine, mail)
    stale, _ = await auth.register("stale@example.com", "correct horse")
    fresh, _ = await auth.register("fresh@example.com", "correct horse")
    kept, _ = await service(engine).register("kept@example.com", "correct horse")
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE users SET created_at = now() - interval '2 days' WHERE id <> :id"),
            {"id": fresh.id},
        )
    # 关掉验证时不删（这些账号能直接登录）
    await Maintenance(engine).purge()
    await Maintenance(engine, purge_unverified=True).purge()
    async with engine.connect() as conn:
        ids = {str(r[0]) for r in await conn.execute(text("SELECT id FROM users"))}
        codes = (await conn.execute(text("SELECT count(*) FROM email_codes"))).scalar_one()
    assert ids == {fresh.id, kept.id} and stale.id not in ids
    assert codes == 1  # 删账号时连带删掉了它的验证码
