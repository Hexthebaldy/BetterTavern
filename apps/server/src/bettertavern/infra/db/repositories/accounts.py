"""users 与 refresh_tokens。"""

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
        )


_USER_COLS = "id, email, password_hash, display_name, locale, settings, created_at"


async def insert_user(
    conn: AsyncConnection, *, email: str, email_norm: str, password_hash: str, display_name: str
) -> UserRow | None:
    """邮箱已被注册时返回 None。"""
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO users (email, email_norm, password_hash, display_name)
        VALUES (:email, :email_norm, :password_hash, :display_name)
        ON CONFLICT (email_norm) DO NOTHING
        RETURNING {_USER_COLS}
        """,
        {
            "email": email,
            "email_norm": email_norm,
            "password_hash": password_hash,
            "display_name": display_name,
        },
    )
    return None if row is None else UserRow.from_row(row)


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


async def purge_expired_refresh_tokens(conn: AsyncConnection) -> int:
    return await execute(
        conn,
        "DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'",
        {},
    )
