"""点数：官方模型的余额、体验额度、开始生成前的检查。

- 扣点在 run_records.charge_run（和 agent_runs 同一个事务）；
- 体验额度：邮箱验证通过后发一次（AuthService 回调 on_verified），同一个邮箱删号重注册不再发
  （credit_grants 存邮箱的 HMAC，不存原文）；同时给用户配上官方模型那一行；
- 开始生成前（开局、提交行动、工作台的 agent 动手）：用的是官方模型时，余额要大于 0，
  全站最近 24 小时的花费也不能超过预算（超过就暂停官方模型，并记一条 error，报错提醒会发邮件）；
- 已经开始的后台整理（世界状态、章节、大纲）照常扣，余额可以短暂变成负数，不卡住故事。
"""

from __future__ import annotations

import hashlib
import hmac
import math
from dataclasses import dataclass

import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.domain.billing import MICRO_PER_POINT, micro_of_points, points
from bettertavern.domain.routing import RouteTask
from bettertavern.infra.db.repositories import credits as repo
from bettertavern.runtime.routing import ResolvedRoute

from .errors import AppError
from .route_service import RouteService

log = structlog.get_logger(__name__)

DAY_S = 86_400
# 估计每回合花多少时看最近一周
ESTIMATE_WINDOW_S = 7 * DAY_S
# 至少有这么多回合的记录才按自己的记录估，不然用默认值
ESTIMATE_MIN_TURNS = 5


@dataclass(frozen=True, slots=True)
class CreditPolicy:
    trial_points: int = 1500
    # 全站最近 24 小时在官方模型上最多花多少微元（50 元）
    daily_budget_micro: int = 50_000_000
    # 没有自己的记录时，估计每回合花多少点（含后台整理）
    default_turn_points: int = 40


@dataclass(frozen=True, slots=True)
class CreditsView:
    balance: int  # 点，欠费时是负数
    turn_points: int  # 估计每回合花多少点
    turns_left: int  # 估计还能写多少回合
    platform: bool  # 这台服务器有没有官方模型
    uses_platform: bool  # 这个用户的导演是不是官方模型


def grant_key(auth_secret: bytes) -> bytes:
    """领体验额度记录里邮箱 HMAC 的密钥：从 AUTH_SECRET 派生。"""
    return hmac.new(auth_secret, b"bettertavern/credit-grant", hashlib.sha256).digest()


class CreditService:
    def __init__(
        self,
        engine: AsyncEngine,
        routes: RouteService,
        policy: CreditPolicy | None = None,
        email_key: bytes = b"dev-credit-grant-key",
    ) -> None:
        self._engine = engine
        self._routes = routes
        self._policy = policy or CreditPolicy()
        self._email_key = email_key

    def _email_hash(self, email_norm: str) -> str:
        return hmac.new(self._email_key, email_norm.encode(), hashlib.sha256).hexdigest()

    # ---- 余额 --------------------------------------------------------------------------
    async def _turn_points(self, user_id: str) -> int:
        async with self._engine.connect() as conn:
            spent, turns = await repo.recent_turn_cost(conn, user_id, seconds=ESTIMATE_WINDOW_S)
        if turns < ESTIMATE_MIN_TURNS:
            return self._policy.default_turn_points
        return max(1, math.ceil(spent / turns / MICRO_PER_POINT))

    async def view(self, user_id: str) -> CreditsView:
        async with self._engine.connect() as conn:
            balance = await repo.balance(conn, user_id) or 0
        director = await self._routes.resolve(user_id, RouteTask.DIRECTOR)
        turn_points = await self._turn_points(user_id)
        return CreditsView(
            balance=points(balance),
            turn_points=turn_points,
            turns_left=max(0, points(balance) // turn_points),
            platform=self._routes.platform is not None,
            uses_platform=director is not None and director.prices is not None,
        )

    # ---- 体验额度 ------------------------------------------------------------------------
    async def on_verified(self, user_id: str, email_norm: str) -> None:
        """邮箱验证通过（或者不要求验证、注册完）：配上官方模型，发体验额度（每个邮箱一次）。"""
        if self._routes.platform is None:
            return
        await self._routes.ensure_platform(user_id)
        amount = micro_of_points(self._policy.trial_points)
        async with self._engine.begin() as conn:
            if not await repo.claim_grant(conn, self._email_hash(email_norm)):
                log.info("credits.trial_skipped", reason="email_already_granted")
                return
            await repo.add(conn, user_id, repo.LedgerEntry(kind="trial", amount_micro=amount))
        log.info("credits.trial_granted", points=self._policy.trial_points)

    # ---- 开始生成前 ----------------------------------------------------------------------
    async def check_route(self, user_id: str, route: ResolvedRoute) -> None:
        """用户自己的 Key 不检查；官方模型要有余额，全站花费也没超预算。"""
        if route.prices is None:
            return
        async with self._engine.connect() as conn:
            balance = await repo.balance(conn, user_id) or 0
            if balance <= 0:
                log.info("credits.exhausted", balance=points(balance))
                raise AppError(
                    "You've used up your credits for the official model. "
                    "Add your own model key in Settings to keep going",
                    code="CREDITS_EXHAUSTED",
                    status=402,
                )
            spent = await repo.spent_since(conn, seconds=DAY_S)
        if spent >= self._policy.daily_budget_micro:
            log.error("credits.daily_budget_reached", spent_points=points(spent))
            raise AppError(
                "The official model is busy right now. Please try again later, "
                "or use your own model key",
                code="PLATFORM_BUSY",
                status=503,
                retryable=True,
            )

    async def check_task(self, user_id: str, task: RouteTask) -> None:
        """还没解析路由的入口（工作台）：先找这个 task 用哪个模型，再检查。

        没配模型的不管，后面运行时会报。
        """
        route = await self._routes.resolve(user_id, task)
        if route is not None:
            await self.check_route(user_id, route)
