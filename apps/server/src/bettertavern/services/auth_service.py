"""账户与令牌：邮箱加密码，短期访问令牌加轮换的刷新令牌；邮箱验证码。

刷新令牌每次使用都换新（同一“家族”）；已用过的令牌再次出现视为被盗，整族吊销。
手机网络下“服务端已轮换、响应丢了、客户端拿旧令牌重试”很常见，所以刚用过 30 秒以内的
令牌允许再换一次，不算盗用。

邮箱验证码（AccountPolicy.verification_required 时注册要验证邮箱；找回密码总是用它）：
- 6 位数字，15 分钟内有效，错 5 次作废；库里只存 HMAC（密钥由 AUTH_SECRET 派生）；
- 同一个邮箱 1 分钟最多发 1 封、1 小时最多 5 封（不管这个邮箱有没有注册，都按同样的规则回应）；
- 找回密码、重发验证码的接口不透露邮箱是否注册过；
- 重置或修改密码后，这个账号所有设备上的登录都退出（修改密码的这台设备换一组新令牌）；
- 一直没验证的账号 24 小时后删掉（services/maintenance.py），不让别人长期占着一个邮箱。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import re
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import structlog
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.story.language import parse_language
from bettertavern.infra.crypto import passwords
from bettertavern.infra.crypto.tokens import (
    AccessTokenSigner,
    InvalidToken,
    hash_refresh_token,
    new_refresh_token,
)
from bettertavern.infra.db.repositories import accounts as repo
from bettertavern.infra.mail import MailError, MailSender
from bettertavern.infra.mail.render import code_mail
from bettertavern.infra.observability.context import bind_user
from bettertavern.infra.ratelimit import RateLimiter

from .errors import AppError, Conflict, Invalid, NotFound, RateLimited, Unauthenticated, Unavailable

# 账户日志不记邮箱和密码；用户用代号 user_ref 表示（登录成功后绑定）
log = structlog.get_logger(__name__)

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
CODE_RE = re.compile(r"^\d{6}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128
REUSE_GRACE_S = 30.0
CODE_TTL_S = 15 * 60
CODE_MAX_ATTEMPTS = 5

CodePurpose = Literal["verify", "reset"]


@dataclass(frozen=True, slots=True)
class AccountPolicy:
    # 注册后要先验证邮箱才能登录（要配好发信服务）
    verification_required: bool = False
    # 关掉以后不能注册新账号（出问题时先止血）
    registration_open: bool = True


@dataclass(frozen=True, slots=True)
class UserView:
    id: str
    email: str
    display_name: str
    locale: str
    created_at: datetime
    email_verified: bool


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
        email_verified=row.verified,
    )


def _check_password(password: str, field: str = "password") -> None:
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise Invalid(
            f"The password must be {MIN_PASSWORD} to {MAX_PASSWORD} characters", field=field
        )


def _check_email(email: str) -> str:
    email = email.strip()
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise Invalid("That email address isn't valid", field="email")
    return email


def _code_expired() -> AppError:
    return AppError(
        "The code has expired, please request a new one", code="CODE_EXPIRED", status=400
    )


class AuthService:
    def __init__(
        self,
        engine: AsyncEngine,
        signer: AccessTokenSigner,
        *,
        refresh_ttl_s: int,
        clock: Callable[[], float] = time.time,
        policy: AccountPolicy | None = None,
        mailer: MailSender | None = None,
        code_key: bytes = b"dev-email-code-key",
    ) -> None:
        self._engine = engine
        self._signer = signer
        self._refresh_ttl = refresh_ttl_s
        self._clock = clock
        self._policy = policy or AccountPolicy()
        self._mailer = mailer
        self._code_key = code_key
        # 同一个邮箱发信的频率（单实例，进程内计数）
        self._per_minute = RateLimiter(1, 60.0)
        self._per_hour = RateLimiter(5, 3600.0)

    @property
    def policy(self) -> AccountPolicy:
        return self._policy

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
        self,
        email: str,
        password: str,
        display_name: str = "",
        user_agent: str | None = None,
        language: str | None = None,
    ) -> tuple[UserView, TokenPair | None]:
        """要验证邮箱时不登录（令牌为 None），发出验证码；否则直接登录。"""
        if not self._policy.registration_open:
            raise AppError("Registration is closed", code="REGISTRATION_CLOSED", status=403)
        email = _check_email(email)
        _check_password(password)
        verify = self._policy.verification_required
        locale = parse_language(language)
        name = display_name.strip()[:40]
        password_hash = await asyncio.to_thread(passwords.hash_password, password)
        async with self._engine.begin() as conn:
            row = await repo.insert_user(
                conn,
                email=email,
                email_norm=normalize_email(email),
                password_hash=password_hash,
                display_name=name,
                locale=locale,
                verified=not verify,
            )
            if row is None and verify:
                # 这个邮箱注册过但没验证：谁能收到验证码谁算数，换成这次填的
                existing = await repo.get_user_by_email(conn, normalize_email(email))
                if existing is not None and not existing.verified:
                    row = await repo.restart_unverified(
                        conn,
                        existing.id,
                        email=email,
                        password_hash=password_hash,
                        display_name=name,
                        locale=locale,
                    )
            if row is None:
                raise Conflict("That email is already registered", code="EMAIL_TAKEN")
            tokens = None
            if not verify:
                tokens = await self._issue(conn, row.id, str(uuid.uuid4()), user_agent)
        bind_user(row.id)
        log.info("auth.registered", verification=verify)
        if verify:
            # 账号已经建好；邮件没发出去时用户可以在验证页“重新发送”
            await self._send_code_quietly(row, "verify", locale)
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
        bind_user(row.id)
        if self._policy.verification_required and not row.verified:
            # 密码对了才说没验证（不暴露邮箱是否注册过），顺便再发一次验证码
            await self._send_code_quietly(row, "verify", None)
            log.info("auth.login_unverified")
            raise AppError(
                "Please verify your email first",
                code="EMAIL_NOT_VERIFIED",
                status=403,
                email=row.email,
            )
        async with self._engine.begin() as conn:
            if passwords.needs_rehash(row.password_hash):
                rehashed = await asyncio.to_thread(passwords.hash_password, password)
                await repo.update_password_hash(conn, row.id, rehashed)
            tokens = await self._issue(conn, row.id, str(uuid.uuid4()), user_agent)
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

    async def change_password(
        self, user_id: str, current: str, new: str, user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        """改密码：其他设备上的登录都退出，这台设备换一组新令牌。"""
        async with self._engine.connect() as conn:
            row = await repo.get_user(conn, user_id)
        if row is None:
            raise NotFound("Account not found")
        ok = await asyncio.to_thread(passwords.verify_password, current, row.password_hash)
        if not ok:
            log.info("account.password_change_rejected", reason="wrong_password")
            raise AppError("Wrong password", code="INVALID_CREDENTIALS", status=403)
        _check_password(new, field="new_password")
        new_hash = await asyncio.to_thread(passwords.hash_password, new)
        async with self._engine.begin() as conn:
            await repo.update_password_hash(conn, user_id, new_hash)
            await repo.revoke_user_tokens(conn, user_id)
            tokens = await self._issue(conn, user_id, str(uuid.uuid4()), user_agent)
        log.info("account.password_changed")
        return _view(row), tokens

    # ---- 邮箱验证码 ---------------------------------------------------------------------
    def _hash_code(self, user_id: str, purpose: str, code: str) -> str:
        message = f"{user_id}:{purpose}:{code}".encode()
        return hmac.new(self._code_key, message, hashlib.sha256).hexdigest()

    def _throttle(self, email_norm: str) -> None:
        for limiter in (self._per_minute, self._per_hour):
            wait = limiter.hit(email_norm)
            if wait is not None:
                raise RateLimited(wait)

    async def _send_code(
        self, user: repo.UserRow, purpose: CodePurpose, language: str | None
    ) -> None:
        if self._mailer is None:
            raise Unavailable("This server can't send email", code="MAIL_UNAVAILABLE")
        code = f"{secrets.randbelow(1_000_000):06d}"
        async with self._engine.begin() as conn:
            await repo.replace_code(
                conn,
                user_id=user.id,
                purpose=purpose,
                code_hash=self._hash_code(user.id, purpose, code),
                expires_at=self._now() + timedelta(seconds=CODE_TTL_S),
            )
        mail = code_mail(user.email, purpose, code, language or user.locale, CODE_TTL_S // 60)
        try:
            await self._mailer.send(mail)
        except MailError as exc:
            log.error("auth.code_mail_failed", purpose=purpose, reason=str(exc))
            raise Unavailable(
                "We couldn't send the email, please try again later",
                code="MAIL_UNAVAILABLE",
                retryable=True,
            ) from exc
        log.info("auth.code_sent", purpose=purpose)

    async def _send_code_quietly(
        self, user: repo.UserRow, purpose: CodePurpose, language: str | None
    ) -> None:
        """注册、登录时顺带发的验证码：发得太频繁或者没发出去都不影响这次请求。"""
        try:
            self._throttle(normalize_email(user.email))
            await self._send_code(user, purpose, language)
        except (RateLimited, Unavailable):
            pass

    async def send_code(self, email: str, purpose: str, language: str | None = None) -> None:
        """重发注册验证码、找回密码。邮箱没注册过、已经验证过时什么都不发，回应和发了一样。"""
        if purpose not in ("verify", "reset"):
            raise Invalid("Unknown purpose", field="purpose")
        if self._mailer is None:
            raise Unavailable("This server can't send email", code="MAIL_UNAVAILABLE")
        norm = normalize_email(_check_email(email))
        self._throttle(norm)
        async with self._engine.connect() as conn:
            user = await repo.get_user_by_email(conn, norm)
        if user is None:
            log.info("auth.code_skipped", purpose=purpose, reason="unknown_email")
            return
        bind_user(user.id)
        if purpose == "verify" and user.verified:
            log.info("auth.code_skipped", purpose=purpose, reason="already_verified")
            return
        await self._send_code(user, "verify" if purpose == "verify" else "reset", language)

    async def _consume_code(
        self, conn: AsyncConnection, user_id: str, purpose: CodePurpose, code: str
    ) -> tuple[str, int]:
        """("ok", 0)、("invalid", 还能试几次) 或 ("expired", 0)。错误次数在调用方的事务里提交。"""
        row = await repo.lock_code(conn, user_id, purpose)
        if row is None or row.expires_at <= self._now() or row.attempts >= CODE_MAX_ATTEMPTS:
            if row is not None:
                await repo.delete_code(conn, row.id)
            return "expired", 0
        if not hmac.compare_digest(row.code_hash, self._hash_code(user_id, purpose, code)):
            left = CODE_MAX_ATTEMPTS - row.attempts - 1
            if left <= 0:
                await repo.delete_code(conn, row.id)
            else:
                await repo.count_failed_attempt(conn, row.id)
            return "invalid", left
        await repo.delete_code(conn, row.id)
        return "ok", 0

    @staticmethod
    def _code_failed(outcome: str, left: int) -> AppError:
        if outcome == "invalid":
            return AppError(
                "That code isn't right", code="CODE_INVALID", status=400, attempts_left=left
            )
        return _code_expired()

    async def verify_email(
        self, email: str, code: str, user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        """注册验证码填对了：标成已验证，并且登录。"""
        code = code.strip()
        if not CODE_RE.match(code):
            raise Invalid("The code is 6 digits", field="code")
        tokens: TokenPair | None = None
        async with self._engine.begin() as conn:
            user = await repo.get_user_by_email(conn, normalize_email(email))
            if user is None:
                raise _code_expired()
            outcome, left = await self._consume_code(conn, user.id, "verify", code)
            if outcome == "ok":
                await repo.mark_verified(conn, user.id)
                tokens = await self._issue(conn, user.id, str(uuid.uuid4()), user_agent)
        bind_user(user.id)
        if tokens is None:
            log.info("auth.code_rejected", purpose="verify", outcome=outcome)
            raise self._code_failed(outcome, left)
        log.info("auth.email_verified")
        async with self._engine.connect() as conn:
            fresh = await repo.get_user(conn, user.id)
        return _view(fresh or user), tokens

    async def reset_password(
        self, email: str, code: str, new_password: str, user_agent: str | None = None
    ) -> tuple[UserView, TokenPair]:
        """找回密码：换上新密码，所有设备上的登录退出，这台设备登录。也算验证了邮箱。"""
        code = code.strip()
        if not CODE_RE.match(code):
            raise Invalid("The code is 6 digits", field="code")
        _check_password(new_password, field="new_password")
        new_hash = await asyncio.to_thread(passwords.hash_password, new_password)
        tokens: TokenPair | None = None
        async with self._engine.begin() as conn:
            user = await repo.get_user_by_email(conn, normalize_email(email))
            if user is None:
                raise _code_expired()
            outcome, left = await self._consume_code(conn, user.id, "reset", code)
            if outcome == "ok":
                await repo.update_password_hash(conn, user.id, new_hash)
                await repo.mark_verified(conn, user.id)
                await repo.revoke_user_tokens(conn, user.id)
                tokens = await self._issue(conn, user.id, str(uuid.uuid4()), user_agent)
        bind_user(user.id)
        if tokens is None:
            log.info("auth.code_rejected", purpose="reset", outcome=outcome)
            raise self._code_failed(outcome, left)
        log.info("account.password_reset")
        async with self._engine.connect() as conn:
            fresh = await repo.get_user(conn, user.id)
        return _view(fresh or user), tokens
