"""每个用户的用量上限：同时在写的 agent、没保存的草稿、存的图一共多大（数值在 settings.py）。

公开部署时防止一个账号占满整台机器：超过时返回 409，客户端按错误码提示。
检查和新建在同一个事务里：事务一开始先 lock_user（同一个用户的这类请求排队），再锁草稿、再查用量，
并发请求不会一起越过上限；锁的顺序固定，不会互相等死。下面的 check_* 都假定已经 lock_user。
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncConnection

from bettertavern.infra.db.repositories import accounts as accounts_repo
from bettertavern.infra.db.repositories import drafts as drafts_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import workbench as workbench_repo

from .errors import AppError

MIB = 1024 * 1024


@dataclass(frozen=True, slots=True)
class Quotas:
    max_running_agents: int = 2
    max_open_drafts: int = 50
    max_image_bytes: int = 200 * MIB


async def lock_user(conn: AsyncConnection, user_id: str) -> None:
    await accounts_repo.lock_user_quota(conn, user_id)


async def check_running_agents(conn: AsyncConnection, user_id: str, quotas: Quotas) -> None:
    if await workbench_repo.count_running(conn, user_id) >= quotas.max_running_agents:
        raise AppError(
            "Too many drafts are being written at once, wait for one to finish",
            code="TOO_MANY_RUNS",
            status=409,
            limit=quotas.max_running_agents,
        )


async def check_open_drafts(conn: AsyncConnection, user_id: str, quotas: Quotas) -> None:
    if await drafts_repo.count_unsaved_drafts(conn, user_id) >= quotas.max_open_drafts:
        raise AppError(
            "Too many unsaved drafts, save or delete some first",
            code="TOO_MANY_DRAFTS",
            status=409,
            limit=quotas.max_open_drafts,
        )


async def storage_left(conn: AsyncConnection, user_id: str, quotas: Quotas) -> int:
    return quotas.max_image_bytes - await library_repo.user_blob_bytes(conn, user_id)


def storage_full(quotas: Quotas) -> AppError:
    return AppError(
        "Your image storage is full, delete some drafts or cards first",
        code="STORAGE_FULL",
        status=409,
        limit_mb=quotas.max_image_bytes // MIB,
    )


async def check_storage(conn: AsyncConnection, user_id: str, quotas: Quotas, adding: int) -> None:
    if await storage_left(conn, user_id, quotas) < adding:
        raise storage_full(quotas)
