"""credentials 与 model_routes。密钥列只存密文，解密在服务层、请求前进行。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.sqlutil import (
    Row,
    as_json,
    dumps,
    execute,
    fetch_all,
    fetch_one,
    opt_str,
)


@dataclass(frozen=True, slots=True)
class CredentialRow:
    id: str
    user_id: str
    provider: str
    label: str
    base_url: str | None
    api_key_enc: str
    key_id: str
    key_last4: str
    extra_headers_enc: str | None
    extra_body: dict[str, Any]
    probed: dict[str, Any]
    status: str
    last_ok_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> CredentialRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            provider=row["provider"],
            label=row["label"],
            base_url=row["base_url"],
            api_key_enc=row["api_key_enc"],
            key_id=row["key_id"],
            key_last4=row["key_last4"],
            extra_headers_enc=row["extra_headers_enc"],
            extra_body=as_json(row["extra_body"], {}),
            probed=as_json(row["probed"], {}),
            status=row["status"],
            last_ok_at=row["last_ok_at"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


_CRED_COLS = """id, user_id, provider, label, base_url, api_key_enc, key_id, key_last4,
    extra_headers_enc, extra_body, probed, status, last_ok_at, created_at, updated_at"""


async def insert_credential(
    conn: AsyncConnection,
    *,
    credential_id: str,
    user_id: str,
    provider: str,
    label: str,
    base_url: str | None,
    api_key_enc: str,
    key_id: str,
    key_last4: str,
    extra_headers_enc: str | None,
    extra_body: dict[str, Any],
) -> CredentialRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO credentials (id, user_id, provider, label, base_url, api_key_enc, key_id,
                                 key_last4, extra_headers_enc, extra_body)
        VALUES (:id, :user_id, :provider, :label, :base_url, :api_key_enc, :key_id,
                :key_last4, :extra_headers_enc, CAST(:extra_body AS jsonb))
        RETURNING {_CRED_COLS}
        """,
        {
            "id": credential_id,
            "user_id": user_id,
            "provider": provider,
            "label": label,
            "base_url": base_url,
            "api_key_enc": api_key_enc,
            "key_id": key_id,
            "key_last4": key_last4,
            "extra_headers_enc": extra_headers_enc,
            "extra_body": dumps(extra_body),
        },
    )
    assert row is not None
    return CredentialRow.from_row(row)


async def list_credentials(conn: AsyncConnection, user_id: str) -> list[CredentialRow]:
    rows = await fetch_all(
        conn,
        f"SELECT {_CRED_COLS} FROM credentials WHERE user_id = :u ORDER BY created_at",
        {"u": user_id},
    )
    return [CredentialRow.from_row(r) for r in rows]


async def get_credential(
    conn: AsyncConnection, user_id: str, credential_id: str, *, lock: bool = False
) -> CredentialRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_CRED_COLS} FROM credentials WHERE id = :id AND user_id = :u"
        + (" FOR UPDATE" if lock else ""),
        {"id": credential_id, "u": user_id},
    )
    return None if row is None else CredentialRow.from_row(row)


async def update_credential(
    conn: AsyncConnection,
    credential_id: str,
    *,
    label: str,
    base_url: str | None,
    api_key_enc: str,
    key_id: str,
    key_last4: str,
    extra_headers_enc: str | None,
    extra_body: dict[str, Any],
    status: str,
    probed: dict[str, Any],
) -> CredentialRow:
    row = await fetch_one(
        conn,
        f"""
        UPDATE credentials
        SET label = :label, base_url = :base_url, api_key_enc = :api_key_enc, key_id = :key_id,
            key_last4 = :key_last4, extra_headers_enc = :extra_headers_enc,
            extra_body = CAST(:extra_body AS jsonb), status = :status,
            probed = CAST(:probed AS jsonb), updated_at = now()
        WHERE id = :id
        RETURNING {_CRED_COLS}
        """,
        {
            "id": credential_id,
            "label": label,
            "base_url": base_url,
            "api_key_enc": api_key_enc,
            "key_id": key_id,
            "key_last4": key_last4,
            "extra_headers_enc": extra_headers_enc,
            "extra_body": dumps(extra_body),
            "status": status,
            "probed": dumps(probed),
        },
    )
    assert row is not None
    return CredentialRow.from_row(row)


async def set_credential_probe(
    conn: AsyncConnection,
    credential_id: str,
    *,
    probed: dict[str, Any],
    status: str | None,
    ok: bool,
) -> None:
    await execute(
        conn,
        """
        UPDATE credentials
        SET probed = CAST(:probed AS jsonb),
            status = COALESCE(:status, status),
            last_ok_at = CASE WHEN :ok THEN now() ELSE last_ok_at END,
            updated_at = now()
        WHERE id = :id
        """,
        {"id": credential_id, "probed": dumps(probed), "status": status, "ok": ok},
    )


async def delete_credential(conn: AsyncConnection, user_id: str, credential_id: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM credentials WHERE id = :id AND user_id = :u",
        {"id": credential_id, "u": user_id},
    )
    return count == 1


# ---- 模型路由 ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RouteRow:
    id: str
    user_id: str
    playthrough_id: str | None
    task: str
    credential_id: str
    model: str
    params: dict[str, Any]
    caps_override: dict[str, Any]
    fallback_route_id: str | None
    updated_at: datetime

    @classmethod
    def from_row(cls, row: Row) -> RouteRow:
        return cls(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            playthrough_id=opt_str(row["playthrough_id"]),
            task=row["task"],
            credential_id=str(row["credential_id"]),
            model=row["model"],
            params=as_json(row["params"], {}),
            caps_override=as_json(row["caps_override"], {}),
            fallback_route_id=opt_str(row["fallback_route_id"]),
            updated_at=row["updated_at"],
        )


_ROUTE_COLS = """id, user_id, playthrough_id, task, credential_id, model, params, caps_override,
    fallback_route_id, updated_at"""


async def list_user_routes(conn: AsyncConnection, user_id: str) -> list[RouteRow]:
    rows = await fetch_all(
        conn,
        f"""SELECT {_ROUTE_COLS} FROM model_routes
            WHERE user_id = :u AND playthrough_id IS NULL ORDER BY task""",
        {"u": user_id},
    )
    return [RouteRow.from_row(r) for r in rows]


async def get_route(conn: AsyncConnection, user_id: str, route_id: str) -> RouteRow | None:
    row = await fetch_one(
        conn,
        f"SELECT {_ROUTE_COLS} FROM model_routes WHERE id = :id AND user_id = :u",
        {"id": route_id, "u": user_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def find_route(
    conn: AsyncConnection, user_id: str, task: str, playthrough_id: str | None
) -> RouteRow | None:
    """单局覆盖优先，其次是用户级的该 task 路由。"""
    row = await fetch_one(
        conn,
        f"""
        SELECT {_ROUTE_COLS} FROM model_routes
        WHERE user_id = :u AND task = :task
          AND (playthrough_id IS NULL OR playthrough_id = :pt)
        ORDER BY (playthrough_id IS NULL)
        LIMIT 1
        """,
        {"u": user_id, "task": task, "pt": playthrough_id},
    )
    return None if row is None else RouteRow.from_row(row)


async def upsert_user_route(
    conn: AsyncConnection,
    *,
    user_id: str,
    task: str,
    credential_id: str,
    model: str,
    params: dict[str, Any],
    caps_override: dict[str, Any],
    fallback_route_id: str | None,
) -> RouteRow:
    row = await fetch_one(
        conn,
        f"""
        INSERT INTO model_routes (user_id, task, credential_id, model, params, caps_override,
                                  fallback_route_id)
        VALUES (:u, :task, :cred, :model, CAST(:params AS jsonb), CAST(:caps AS jsonb), :fb)
        ON CONFLICT (user_id, task) WHERE playthrough_id IS NULL
        DO UPDATE SET credential_id = EXCLUDED.credential_id, model = EXCLUDED.model,
                      params = EXCLUDED.params, caps_override = EXCLUDED.caps_override,
                      fallback_route_id = EXCLUDED.fallback_route_id, updated_at = now()
        RETURNING {_ROUTE_COLS}
        """,
        {
            "u": user_id,
            "task": task,
            "cred": credential_id,
            "model": model,
            "params": dumps(params),
            "caps": dumps(caps_override),
            "fb": fallback_route_id,
        },
    )
    assert row is not None
    return RouteRow.from_row(row)


async def delete_user_route(conn: AsyncConnection, user_id: str, task: str) -> bool:
    count = await execute(
        conn,
        "DELETE FROM model_routes WHERE user_id = :u AND task = :task AND playthrough_id IS NULL",
        {"u": user_id, "task": task},
    )
    return count == 1
