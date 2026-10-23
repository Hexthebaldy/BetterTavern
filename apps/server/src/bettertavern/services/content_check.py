"""内容检查：官方服务（CONTENT_POLICY=sfw）上，角色卡存进仓库之前先让模型判断有没有色情内容。

- 用官方模型（运营方的 Key，不扣用户的点数）；服务器没配官方模型时，用这个用户自己的导演；
  都没有就跳过（只记一条 warning）；
- 有露骨的性描写、以性为主题，或者涉及未成年人的性内容：422 CONTENT_REJECTED，不存；
- 检查本身出错（服务商不可用、回的不是 JSON）：503 CONTENT_CHECK_UNAVAILABLE，
  宁可让用户稍后再存，也不放过；
- 自己部署的（CONTENT_POLICY=open）不检查。卡片文字不进日志，只记判断结果。
"""

from __future__ import annotations

import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.providers import ProviderHub
from bettertavern.runtime.agents.content_check import check_card
from bettertavern.runtime.prompts import PromptBook

from .errors import AppError
from .route_service import RouteService

log = structlog.get_logger(__name__)


class ContentChecker:
    def __init__(self, hub: ProviderHub, prompts: PromptBook, routes: RouteService) -> None:
        self._hub = hub
        self._prompts = prompts
        self._routes = routes

    @property
    def enabled(self) -> bool:
        return self._prompts.content_policy == "sfw"

    async def check_card(
        self, user_id: str, card: CharacterCard, *, display_name: str, language: str
    ) -> None:
        if not self.enabled:
            return
        route = self._routes.platform_route(RouteTask.GATE)
        if route is None:
            route = await self._routes.resolve(user_id, RouteTask.GATE)
        if route is None:
            log.warning("content.check_skipped", reason="no_model")
            return
        try:
            result = await check_card(
                route,
                self._hub.adapter(route.provider),
                card,
                self._prompts.get(language),
                display_name=display_name,
            )
        except AppError:
            raise
        except Exception as exc:
            log.warning("content.check_failed", error=type(exc).__name__)
            raise AppError(
                "We couldn't check this card's content right now. Please try saving again later",
                code="CONTENT_CHECK_UNAVAILABLE",
                status=503,
                retryable=True,
            ) from exc
        verdict = result.verdict
        if result.allowed:
            log.info("content.card_allowed")
            return
        log.info("content.card_rejected", sexual=verdict.sexual, minors=verdict.minors)
        reasons = [
            name for name, hit in (("sexual", verdict.sexual), ("minors", verdict.minors)) if hit
        ]
        raise AppError(
            "This card has content that isn't allowed on this service",
            code="CONTENT_REJECTED",
            status=422,
            reasons=reasons,
        )
