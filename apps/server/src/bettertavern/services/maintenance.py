"""维护任务：清理过期租约（生成进程没了的回合标为失败）、过期的幂等键与刷新令牌、
一天以前的工作台推送事件、七天以前读过的网页。

api 进程定期调用；多个实例同时跑也没关系（SKIP LOCKED，删除语句幂等）。
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.db.repositories import accounts as accounts_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import web as web_repo
from bettertavern.infra.db.repositories import workbench as workbench_repo

# 工作台的推送事件留一天：内容早已存进对话记录和草稿，事件只是路上用的
WORKBENCH_EVENTS_TTL_S = 86_400
# 读过的网页留 7 天（24 小时内再读同一个地址直接用缓存）
WEB_PAGES_TTL_S = 7 * 86_400

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
            await workbench_repo.delete_old_events(conn, older_than_s=WORKBENCH_EVENTS_TTL_S)
            await web_repo.delete_old_pages(conn, older_than_s=WEB_PAGES_TTL_S)

    async def tick(self) -> None:
        """每次都清租约；每 40 次（约 10 分钟）清一次过期数据。"""
        self._runs += 1
        await self.sweep_leases()
        if self._runs % 40 == 1:
            await self.purge()
