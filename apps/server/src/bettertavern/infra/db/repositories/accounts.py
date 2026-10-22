"""users、refresh_tokens 与 email_codes。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import Row, as_json, execute, fetch_one


@dataclass(frozen=True, slots=True)
class UserRow:
    id: str
    email: str
    password_hash: str
    display_name: str
    locale: str
    settings: dict[str, Any]
    created_at: datetime
    email_verified_at: datetime | None

    @property
    def verified(self) -> bool:
        return self.email_verified_at is not None

    @classmethod
    def from_row(cls, row: Row) -> UserRow:
        return cls(
            id=str(row["id"]),
            email=row["email"],
            password_hash=row["password_hash"],
            display_name=row["display_name"],
            locale=row["locale"],
            settings=as_json(row["settings"], {}),
            created_at=row["created_at"],
            email_verified_at=row["email_verified_at"],
        )


_USER_COLS = (
    "id, email, password_hash, display_name, locale, settings, created_at, email_verified_at"
)


async def insert_user(
    conn: AsyncConnection,
    *,
    email: str,
    email_norm: str,
    password_hash: str,
    display_name: str,
    locale: str,
    verified: bool,
) -> UserRow | None:
    """邮箱已被注册时返回 None。verified：不要求验证邮箱时直接记为已验证。"""
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO users
            (email, email_norm, password_hash, display_name, locale, email_verified_at)
        VALUES (:email, :email_norm, :password_hash, :display_name, :locale,
                CASE WHEN :verified THEN now() END)
        ON CONFLICT (email_norm) DO NOTHING
        RETURNING {_USER_COLS}
        """,
        {
            "email": email,
            "email_norm": email_norm,
            "password_hash": password_hash,
            "display_name": display_name,
            "locale": locale,
            "verified": verified,
        },
    )
    return None if row is None else UserRow.from_row(row)


async def restart_unverified(
    conn: AsyncConnection,
    user_id: str,
    *,
    email: str,
    password_hash: str,
    display_name: str,
    locale: str,
) -> UserRow | None:
    """还没验证的账号又注册了一次：换成这次填的密码、昵称（谁能收到验证码才算数）。

    已验证的不动，返回 None。
    """
    row = await fetch_one(
        conn,
        f"""
        UPDATE users SET email = :email, password_hash = :h, display_name = :name,
            locale = :locale, created_at = now(), updated_at = now()
        WHERE id = :id AND email_verified_at IS NULL
        RETURNING {_USER_COLS}
        """,
        {
            "id": user_id,
            "email": email,
            "h": password_hash,
            "name": display_name,
            "locale": locale,
        },
    )
    return None if row is None else UserRow.from_row(row)


async def mark_verified(conn: AsyncConnection, user_id: str) -> None:
    await execute(
        conn,
        """
        UPDATE users SET email_verified_at = now(), updated_at = now()
        WHERE id = :id AND email_verified_at IS NULL
        """,
        {"id": user_id},
    )


async def purge_unverified_users(conn: AsyncConnection, *, older_than_s: int) -> int:
    """注册以后一直没验证邮箱的账号（不让别人长期占着一个邮箱）。"""
    return await execute(
        conn,
        """
        DELETE FROM users
        WHERE email_verified_at IS NULL
          AND created_at < now() - make_interval(secs => :s)
        """,
        {"s": older_than_s},
    )


async def get_user_by_email(conn: AsyncConnection, email_norm: str) -> UserRow | None:
    row = await fetch_one(
        conn, f"SELECT {_USER_COLS} FROM users WHERE email_norm = :e", {"e": email_norm}
    )
    return None if row is None else UserRow.from_row(row)


async def get_user(conn: AsyncConnection, user_id: str) -> UserRow | None:
    row = await fetch_one(conn, f"SELECT {_USER_COLS} FROM users WHERE id = :id", {"id": user_id})
    return None if row is None else UserRow.from_row(row)


async def update_password_hash(conn: AsyncConnection, user_id: str, password_hash: str) -> None:
    await execute(
        conn,
        "UPDATE users SET password_hash = :h, updated_at = now() WHERE id = :id",
        {"h": password_hash, "id": user_id},
    )


async def delete_user(conn: AsyncConnection, user_id: str) -> bool:
    return await execute(conn, "DELETE FROM users WHERE id = :id", {"id": user_id}) == 1


# ---- 刷新令牌 ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RefreshTokenRow:
    id: str
    user_id: str
    family_id: str
    expires_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None

    @classmethod
    def from_row(cls, row: Row) -> RefreshTokenRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            family_id=str(row["family_id"]),
            expires_at=row["expires_at"],
            used_at=row["used_at"],
            revoked_at=row["revoked_at"],
        )


async def insert_refresh_token(
    conn: AsyncConnection,
    *,
    user_id: str,
    family_id: str,
    token_hash: str,
    expires_at: datetime,
    user_agent: str | None,
) -> str:
    row = await fetch_one(
        conn,
        """
        INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
        VALUES (:user_id, :family_id, :token_hash, :expires_at, :user_agent)
        RETURNING id
        """,
        {
            "user_id": user_id,
            "family_id": family_id,
            "token_hash": token_hash,
            "expires_at": expires_at,
            "user_agent": (user_agent or "")[:200] or None,
        },
    )
    assert row is not None
    return str(row["id"])


async def lock_refresh_token(conn: AsyncConnection, token_hash: str) -> RefreshTokenRow | None:
    """按哈希取刷新令牌并加行锁，同一令牌的并发刷新因此串行。"""
    row = await fetch_one(
        conn,
        """
        SELECT id, user_id, family_id, expires_at, used_at, revoked_at
        FROM refresh_tokens WHERE token_hash = :h FOR UPDATE
        """,
        {"h": token_hash},
    )
    return None if row is None else RefreshTokenRow.from_row(row)


async def mark_refresh_token_used(conn: AsyncConnection, token_id: str, *, at: datetime) -> None:
    # 用应用传入的时间而不是数据库的 now()：宽限期是和应用的时钟比的，两边时钟不一致也不出错
    await execute(
        conn, "UPDATE refresh_tokens SET used_at = :at WHERE id = :id", {"id": token_id, "at": at}
    )


async def revoke_family(conn: AsyncConnection, family_id: str) -> int:
    return await execute(
        conn,
        """
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = :f AND revoked_at IS NULL
        """,
        {"f": family_id},
    )


async def revoke_user_tokens(conn: AsyncConnection, user_id: str) -> int:
    """改密码、重置密码时：这个账号所有设备上的登录都退出。"""
    return await execute(
        conn,
        """
        UPDATE refresh_tokens SET revoked_at = now()
        WHERE user_id = :u AND revoked_at IS NULL
        """,
        {"u": user_id},
    )


async def purge_expired_refresh_tokens(conn: AsyncConnection) -> int:
    return await execute(
        conn,
        "DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'",
        {},
    )


# ---- 邮箱验证码 -------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class EmailCodeRow:
    id: str
    code_hash: str
    attempts: int
    expires_at: datetime
    created_at: datetime


async def replace_code(
    conn: AsyncConnection, *, user_id: str, purpose: str, code_hash: str, expires_at: datetime
) -> None:
    """发新验证码：同一账号同一用途只留最新的一个，错误次数清零。"""
    await execute(
        conn,
        """
        INSERT INTO email_codes (user_id, purpose, code_hash, expires_at)
        VALUES (:u, :p, :h, :e)
        ON CONFLICT (user_id, purpose) DO UPDATE
        SET code_hash = EXCLUDED.code_hash, attempts = 0,
            expires_at = EXCLUDED.expires_at, created_at = now()
        """,
        {"u": user_id, "p": purpose, "h": code_hash, "e": expires_at},
    )


async def lock_code(conn: AsyncConnection, user_id: str, purpose: str) -> EmailCodeRow | None:
    """取验证码并加行锁：同一个码的并发尝试串行，错误次数不会少算。"""
    row = await fetch_one(
        conn,
        """
        SELECT id, code_hash, attempts, expires_at, created_at FROM email_codes
        WHERE user_id = :u AND purpose = :p FOR UPDATE
        """,
        {"u": user_id, "p": purpose},
    )
    if row is None:
        return None
    return EmailCodeRow(
        id=str(row["id"]),
        code_hash=row["code_hash"],
        attempts=row["attempts"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
    )


async def count_failed_attempt(conn: AsyncConnection, code_id: str) -> None:
    await execute(
        conn, "UPDATE email_codes SET attempts = attempts + 1 WHERE id = :id", {"id": code_id}
    )


async def delete_code(conn: AsyncConnection, code_id: str) -> None:
    await execute(conn, "DELETE FROM email_codes WHERE id = :id", {"id": code_id})


async def purge_expired_codes(conn: AsyncConnection) -> int:
    return await execute(conn, "DELETE FROM email_codes WHERE expires_at < now()", {})


async def lock_user_quota(conn: AsyncConnection, user_id: str) -> None:
    """同一个用户的“查用量、再新建”排队做（事务结束自动放开），并发请求不会一起越过上限。"""
    await execute(
        conn, "SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))", {"k": f"quota:{user_id}"}
    )
