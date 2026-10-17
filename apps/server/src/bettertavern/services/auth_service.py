"""账户与令牌：邮箱加密码，短期访问令牌加轮换的刷新令牌。

刷新令牌每次使用都换新（同一“家族”）；已用过的令牌再次出现视为被盗，整族吊销。
手机网络下“服务端已轮换、响应丢了、客户端拿旧令牌重试”很常见，所以刚用过 30 秒以内的
令牌允许再换一次，不算盗用。
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.infra.crypto import passwords
from bettertavern.infra.crypto.tokens import (
    AccessTokenSigner,
    InvalidToken,
    hash_refresh_token,
    new_refresh_token,
)
from bettertavern.infra.db.repositories import accounts as repo
from bettertavern.infra.observability.context import bind_user

from .errors import AppError, Conflict, Invalid, NotFound, Unauthenticated

# 账户日志不记邮箱和密码；用户用代号 user_ref 表示（登录成功后绑定）
log = structlog.get_logger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128
REUSE_GRACE_S = 30.0


@dataclass(frozen=True, slots=True)
class UserView:
    id: str
    email: str
    display_name: str
    locale: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class TokenPair:
    access_token: str
    expires_in: int
    refresh_token: str
    refresh_expires_at: datetime
    token_type: str = "Bearer"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _view(row: repo.UserRow) -> UserView:
    return UserView(
        id=row.id,
        email=row.email,
        display_name=row.display_name,
        locale=row.locale,
        created_at=row.created_at,
    )


class AuthService:
    def __init__(
        self,
        engine: AsyncEngine,
        signer: AccessTokenSigner,
        *,
        refresh_ttl_s: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._engine = engine
        self._signer = signer
        self._refresh_ttl = refresh_ttl_s
        self._clock = clock

    def _now(self) -> datetime:
        return datetime.fromtimestamp(self._clock(), UTC)

    # ---- 访问令牌 ------------------------------------------------------------------------
    def authenticate(self, access_token: str) -> str:
        try:
            return self._signer.verify(access_token).user_id
        except InvalidToken as exc:
            raise Unauthenticated("Session expired, please sign in again") from exc

    def _access(self, user_id: str) -> tuple[str, int]:
        token, exp = self._signer.issue(user_id)
        return token, max(exp - int(self._clock()), 0)

    async def _issue(
        self, conn: AsyncConnection, user_id: str, family_id: str, user_agent: str | None
    ) -> TokenPair:
        refresh = new_refresh_token()
        expires_at = self._now() + timedelta(seconds=self._refresh_ttl)
        await repo.insert_refresh_token(
            conn,
            user_id=user_id,
            family_id=family_id,
            token_hash=hash_refresh_token(refresh),
            expires_at=expires_at,
            user_agent=user_agent,
        )
        access, expires_in = self._access(user_id)
        return TokenPair(
            access_token=access,
            expires_in=expires_in,
            refresh_token=refresh,
            refresh_expires_at=expires_at,
        )

    # ---- 注册与登录 ----------------------------------------------------------------------
    async def register(
        self, email: str, password: str, display_name: str = "", user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        email = email.strip()
        if not EMAIL_RE.match(email) or len(email) > 254:
            raise Invalid("That email address isn't valid", field="email")
        if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
            raise Invalid(
                f"The password must be {MIN_PASSWORD} to {MAX_PASSWORD} characters",
                field="password",
            )
        password_hash = await asyncio.to_thread(passwords.hash_password, password)
        async with self._engine.begin() as conn:
            row = await repo.insert_user(
                conn,
                email=email,
                email_norm=normalize_email(email),
                password_hash=password_hash,
                display_name=display_name.strip()[:40],
            )
            if row is None:
                raise Conflict("That email is already registered", code="EMAIL_TAKEN")
            tokens = await self._issue(conn, row.id, str(uuid.uuid4()), user_agent)
        bind_user(row.id)
        log.info("auth.registered")
        return _view(row), tokens

    async def login(
        self, email: str, password: str, user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        async with self._engine.connect() as conn:
            row = await repo.get_user_by_email(conn, normalize_email(email))
        encoded = row.password_hash if row is not None else passwords.DUMMY_HASH
        ok = await asyncio.to_thread(passwords.verify_password, password, encoded)
        if row is None or not ok:
            # 原因只记在日志里，返回给客户端的永远是同一句话（不暴露邮箱是否注册过）
            if row is not None:
                bind_user(row.id)
            log.info(
                "auth.login_failed", reason="unknown_email" if row is None else "wrong_password"
            )
            raise Unauthenticated("Wrong email or password", code="INVALID_CREDENTIALS")
        async with self._engine.begin() as conn:
            if passwords.needs_rehash(row.password_hash):
                rehashed = await asyncio.to_thread(passwords.hash_password, password)
                await repo.update_password_hash(conn, row.id, rehashed)
            tokens = await self._issue(conn, row.id, str(uuid.uuid4()), user_agent)
        bind_user(row.id)
        log.info("auth.login")
        return _view(row), tokens

    async def refresh(
        self, refresh_token: str, user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        reused_family: str | None = None
        result: tuple[UserView, TokenPair] | None = None
        async with self._engine.begin() as conn:
            row = await repo.lock_refresh_token(conn, hash_refresh_token(refresh_token))
            now = self._now()
            if row is None or row.revoked_at is not None or row.expires_at <= now:
                reason = (
                    "unknown"
                    if row is None
                    else ("revoked" if row.revoked_at is not None else "expired")
                )
                log.info("auth.refresh_invalid", reason=reason)
                raise Unauthenticated(
                    "Session expired, please sign in again", code="REFRESH_INVALID"
                )
            if row.used_at is not None and (now - row.used_at).total_seconds() > REUSE_GRACE_S:
                # 用过的令牌又出现了：可能被盗。整族吊销，提交后再报错
                await repo.revoke_family(conn, row.family_id)
                reused_family = row.family_id
                bind_user(row.user_id)
                log.warning("auth.refresh_reused")
            else:
                user = await repo.get_user(conn, row.user_id)
                if user is None:
                    raise Unauthenticated("Account not found", code="REFRESH_INVALID")
                if row.used_at is None:
                    await repo.mark_refresh_token_used(conn, row.id, at=now)
                tokens = await self._issue(conn, row.user_id, row.family_id, user_agent)
                result = (_view(user), tokens)
                bind_user(row.user_id)
                log.info("auth.refresh")
        if reused_family is not None or result is None:
            raise Unauthenticated("Session expired, please sign in again", code="REFRESH_REUSED")
        return result

    async def logout(self, refresh_token: str) -> None:
        async with self._engine.begin() as conn:
            row = await repo.lock_refresh_token(conn, hash_refresh_token(refresh_token))
            if row is not None:
                await repo.revoke_family(conn, row.family_id)
                bind_user(row.user_id)
        log.info("auth.logout", known_token=row is not None)

    # ---- 账户 ---------------------------------------------------------------------------
    async def get_user(self, user_id: str) -> UserView:
        async with self._engine.connect() as conn:
            row = await repo.get_user(conn, user_id)
        if row is None:
            raise NotFound("Account not found")
        return _view(row)

    async def delete_account(self, user_id: str, password: str) -> None:
        async with self._engine.connect() as conn:
            row = await repo.get_user(conn, user_id)
        if row is None:
            raise NotFound("Account not found")
        ok = await asyncio.to_thread(passwords.verify_password, password, row.password_hash)
        if not ok:
            log.warning("account.delete_rejected", reason="wrong_password")
            raise AppError("Wrong password", code="INVALID_CREDENTIALS", status=403)
        async with self._engine.begin() as conn:
            await repo.delete_user(conn, user_id)
        log.info("account.deleted")
