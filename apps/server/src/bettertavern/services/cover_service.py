"""封面面板里直接生成封面（不经过 agent，docs/workbench.md 第 4.3、6 节）：
用默认的文生图配置出几张候选，存进草稿的图片（版权记为 own），由用户挑一张当封面。

生图要花钱：一次最多 4 张；提示词和风格由用户在面板里写，风格拼进提示词。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Literal

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.importers.images import ImageError as CleanError
from bettertavern.importers.images import clean_image
from bettertavern.infra.db.repositories import drafts as drafts_repo
from bettertavern.infra.db.repositories import library as library_repo
from bettertavern.infra.db.sqlutil import is_uuid
from bettertavern.providers.image import IMAGE_PROTOCOLS, STYLE_HINTS, ImageConfig, ImageError
from bettertavern.providers.web import WebError, download_image

from .draft_service import AssetView, asset_view
from .errors import AppError, Invalid, NotFound
from .quotas import Quotas, lock_user, storage_full, storage_left
from .tool_route_service import ToolRouteService

log = structlog.get_logger(__name__)

MAX_COVERS = 4
Aspect = Literal["portrait", "square", "landscape"]


@dataclass(frozen=True, slots=True)
class CoverRequest:
    prompt: str
    style: str = ""
    count: int = 4
    aspect: Aspect = "portrait"


class CoverService:
    def __init__(
        self,
        engine: AsyncEngine,
        tools: ToolRouteService,
        client: httpx.AsyncClient,
        quotas: Quotas | None = None,
    ) -> None:
        self._engine = engine
        self._tools = tools
        self._client = client
        self._quotas = quotas or Quotas()

    async def generate(self, user_id: str, draft_id: str, req: CoverRequest) -> list[AssetView]:
        if not is_uuid(draft_id):
            raise NotFound("Draft not found")
        async with self._engine.connect() as conn:
            if await drafts_repo.get_draft(conn, user_id, draft_id) is None:
                raise NotFound("Draft not found")
            # 先看还有没有地方存，满了就不必去花出图的钱
            if await storage_left(conn, user_id, self._quotas) <= 0:
                raise storage_full(self._quotas)
        config = await self._tools.default_image(user_id)
        if config is None or config.provider not in IMAGE_PROTOCOLS:
            raise AppError(
                "No text-to-image service is set up", code="TOOL_ROUTE_MISSING", status=409
            )
        prompt = req.prompt.replace("\x00", "").strip()[:4000]
        if not prompt:
            raise Invalid("Describe the cover", field="prompt")
        if req.style:
            prompt = f"{prompt}\n\nStyle: {STYLE_HINTS.get(req.style, req.style)}."
        count = max(1, min(req.count, MAX_COVERS))
        protocol = IMAGE_PROTOCOLS[config.provider]
        try:
            results = await protocol.generate(
                self._client,
                ImageConfig(
                    model=config.model,
                    api_key=config.api_key,
                    base_url=config.base_url,
                    params=config.params,
                ),
                prompt=prompt,
                aspect=req.aspect,
                count=count,
            )
        except ImageError as exc:
            log.warning("cover.failed", draft_id=draft_id, kind=exc.kind)
            raise AppError(
                f"The image service failed: {exc.message}",
                code="TOOL_ROUTE_INVALID",
                status=502,
                reason=exc.kind,
            ) from exc
        except httpx.HTTPError as exc:
            raise AppError(
                "Couldn't reach the image service",
                code="TOOL_ROUTE_INVALID",
                status=502,
                reason="network",
            ) from exc
        assets: list[AssetView] = []
        for result in results[:count]:
            try:
                data = (
                    result.data
                    if result.data is not None
                    else await download_image(self._client, result.url or "")
                )
                image = await asyncio.to_thread(clean_image, data)
            except (WebError, CleanError, httpx.HTTPError):
                continue
            async with self._engine.begin() as conn:
                await lock_user(conn, user_id)
                if await storage_left(conn, user_id, self._quotas) < len(image.data):
                    # 存满了：已经存下的几张照常返回
                    if assets:
                        break
                    raise storage_full(self._quotas)
                blob_id = await library_repo.insert_blob(
                    conn,
                    user_id=user_id,
                    sha256=image.sha256,
                    mime=image.mime,
                    data=image.data,
                    width=image.width,
                    height=image.height,
                )
                row = await drafts_repo.insert_asset(
                    conn,
                    user_id=user_id,
                    draft_id=draft_id,
                    blob_id=blob_id,
                    source="generated",
                    license="own",
                    prompt=prompt,
                    meta={
                        "tool_route_id": config.route_id,
                        "protocol": config.provider,
                        "model": config.model,
                        "aspect": req.aspect,
                        "style": req.style,
                    },
                )
            assets.append(asset_view(row))
        if not assets:
            raise AppError(
                "The image service returned no usable image",
                code="TOOL_ROUTE_INVALID",
                status=502,
                reason="bad_response",
            )
        log.info("cover.generated", draft_id=draft_id, count=len(assets), protocol=config.provider)
        return assets
