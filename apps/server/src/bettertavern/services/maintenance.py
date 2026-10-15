"""维护任务：清理过期租约（生成进程没了的回合标为失败）、过期的幂等键与刷新令牌。

api 进程定期调用；多个实例同时跑也没关系（SKIP LOCKED，删除语句幂等）。
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.db.repositories import accounts as accounts_repo
from bettertavern.infra.db.repositories import story as story_repo

log = structlog.get_logger(__name__)


class Maintenance:
    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        self._runs = 0

    async def sweep_leases(self) -> list[str]:
        async with self._engine.begin() as conn:
            failed = await story_repo.sweep_expired_leases(conn)
            for turn_id in failed:
                await story_repo.notify_turn(conn, turn_id)
        if failed:
            # 生成进程没了，这些回合已标为失败（RUNNER_LOST）
            log.warning("turn.lease_expired", count=len(failed), turn_ids=failed)
        return failed

    async def purge(self) -> None:
        async with self._engine.begin() as conn:
            await story_repo.purge_idempotency_keys(conn)
            await accounts_repo.purge_expired_refresh_tokens(conn)

    async def tick(self) -> None:
        """每次都清租约；每 40 次（约 10 分钟）清一次过期数据。"""
        self._runs += 1
        await self.sweep_leases()
        if self._runs % 40 == 1:
            await self.purge()
