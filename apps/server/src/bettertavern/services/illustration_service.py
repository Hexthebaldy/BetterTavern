"""故事配图（docs/illustrations.md）：点“画这一幕”、查画好了没、删掉；读回合时带上它们的图。

点下去时检查完就插一行（pending）并放一个后台任务，马上返回；画的过程在 worker 里
（runtime/illustration_runner.py）。客户端每隔几秒查一次这一行。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import structlog
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.illustration import (
    DEADLINE_S,
    MAX_PENDING,
    can_draw,
    clean_request,
    normalize_style,
)
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.repositories import story as story_repo
from bettertavern.infra.db.repositories import turn_images as images_repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.infra.queue.pg_queue import PgJobQueue
from bettertavern.providers.image import IMAGE_PROTOCOLS

from .credits import CreditService
from .errors import AppError, Conflict, NotFound
from .illustration_jobs import enqueue_image
from .quotas import Quotas, lock_user, storage_full, storage_left
from .route_service import RouteService
from .tool_route_service import ToolRouteService
from .views import TurnImageView

log = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class DrawRequest:
    request: str = ""  # 想看什么，可以不填
    style: str | None = None  # 画风；不给时用这一局记下的


async def turn_images(
    conn: AsyncConnection, turn_ids: Sequence[str]
) -> dict[str, list[TurnImageView]]:
    """几个回合各自的图（读回合列表、详情时一起返回）。"""
    found = await images_repo.list_for_turns(conn, turn_ids)
    return {turn: [TurnImageView.of(r) for r in rows] for turn, rows in found.items()}


class IllustrationService:
    def __init__(
        self,
        engine: AsyncEngine,
        routes: RouteService,
        tools: ToolRouteService,
        quotas: Quotas | None = None,
        credits: CreditService | None = None,
    ) -> None:
        self._engine = engine
        self._routes = routes
        self._tools = tools
        self._quotas = quotas or Quotas()
        self._credits = credits
        self._queue = PgJobQueue(engine)

    async def draw(self, user_id: str, turn_id: str, req: DrawRequest) -> TurnImageView:
        if not is_uuid(turn_id):
            raise NotFound("Turn not found")
        async with self._engine.connect() as conn:
            turn = await story_repo.get_user_turn(conn, user_id, turn_id)
        if turn is None:
            raise NotFound("Turn not found")
        if not can_draw(turn.status):
            raise Conflict("Only finished turns can be illustrated", code="TURN_NOT_SETTLED")
        config = await self._tools.default_image(user_id)
        if config is None or config.provider not in IMAGE_PROTOCOLS:
            raise AppError(
                "No text-to-image service is set up", code="TOOL_ROUTE_MISSING", status=409
            )
        route = await self._routes.resolve(user_id, RouteTask.ILLUSTRATOR, turn.playthrough_id)
        if route is None:
            raise AppError(
                "No director model is set up yet. Add a key and choose a model in Settings",
                code="ROUTE_MISSING",
                status=409,
            )
        if self._credits is not None:
            await self._credits.check_route(user_id, route)
        request = clean_request(req.request)
        try:
            async with self._engine.begin() as conn:
                pt = await story_repo.get_playthrough(conn, user_id, turn.playthrough_id)
                if pt is None:
                    raise NotFound("Turn not found")
                style = (
                    normalize_style(req.style)
                    if req.style is not None
                    else normalize_style(str(pt.settings.get("image_style") or ""))
                )
                # 同一个人的几次点击排队检查，同时在画的张数才算得准
                await lock_user(conn, user_id)
                await images_repo.expire_pending(conn, deadline_s=DEADLINE_S, user_id=user_id)
                if await images_repo.has_pending(conn, turn_id):
                    raise Conflict("This turn is already being illustrated", code="IMAGE_PENDING")
                if await images_repo.count_pending(conn, user_id) >= MAX_PENDING:
                    raise AppError(
                        "Too many pictures are being drawn, wait for one to finish",
                        code="TOO_MANY_IMAGES",
                        status=429,
                        limit=MAX_PENDING,
                    )
                # 先看还有没有地方存，满了就不必去花出图的钱
                if await storage_left(conn, user_id, self._quotas) <= 0:
                    raise storage_full(self._quotas)
                await images_repo.delete_failed(conn, turn_id)
                image_id = await images_repo.insert_image(
                    conn,
                    user_id=user_id,
                    playthrough_id=turn.playthrough_id,
                    turn_id=turn_id,
                    request=request,
                    style=style,
                )
                if req.style is not None and style != (pt.settings.get("image_style") or ""):
                    await story_repo.set_image_style(conn, pt.id, style)
                await enqueue_image(conn, self._queue, image_id)
        except IntegrityError as exc:
            # 两次点击同时通过了检查：唯一索引只放进去一个
            raise Conflict("This turn is already being illustrated", code="IMAGE_PENDING") from exc
        log.info("illustration.requested", image_id=image_id, style=style or None)
        return await self.get(user_id, image_id)

    async def get(self, user_id: str, image_id: str) -> TurnImageView:
        if not is_uuid(image_id):
            raise NotFound("Image not found")
        async with self._engine.connect() as conn:
            row = await images_repo.get_image(conn, image_id, user_id)
        if row is None:
            raise NotFound("Image not found")
        return TurnImageView.of(row)

    async def delete(self, user_id: str, image_id: str) -> None:
        """删掉一张图（或一条没画出来的记录）；还在画的也能删，画好时会被丢掉。"""
        if not is_uuid(image_id):
            raise NotFound("Image not found")
        async with self._engine.begin() as conn:
            blob_id = await images_repo.delete_image(conn, image_id, user_id)
            if blob_id is None:
                raise NotFound("Image not found")
            if blob_id:
                await library_repo.delete_orphan_blobs(conn, user_id, [blob_id])
