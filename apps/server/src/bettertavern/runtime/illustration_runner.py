"""故事配图的后台任务（docs/illustrations.md 第 2 节）：worker 领到 story.image 后调用 process()。

1. 读材料（IllustrationStore.load）：那一行已经不在画了（删了、超时、画好了）就什么都不做；
   排队等太久、已经超过时限的直接记失败（timeout）。
2. 用导演的模型写画面描述（agents/illustrator.py）。没有模型记 route_missing，出错记 model_failed。
3. 用默认的出图服务画一张横图。没配记 tool_missing，服务报错按 ImageError.kind 记。
   画里的人有封面或头像的，带上当参考图（服务支持几张带几张）；带了参考图报错时去掉再试一次。
4. 下载、清洗、转成 WebP，交给 store.commit；图片空间满了记 storage_full。

整个过程不超过从点下去算起的时限（domain/story/illustration.py 的 DEADLINE_S），超了记 timeout。
写画面描述那次调用记进 agent_runs（用官方模型时照样扣点数）；出图用的是玩家自己的服务，不扣点数。
日志里不写正文和画面描述。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import httpx
import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.illustration import time_left
from bettertavern.importers.images import ImageError as CleanError
from bettertavern.importers.images import scene_image
from bettertavern.providers import ProviderError, ProviderHub
from bettertavern.providers.image import (
    IMAGE_PROTOCOLS,
    STYLE_HINTS,
    GeneratedImage,
    ImageConfig,
    ImageError,
    ImageProtocol,
    Reference,
)
from bettertavern.providers.limiter import LimiterTimeout
from bettertavern.providers.web import WebError, download_image

from .agent import StepLog
from .agents.illustrator import AGENT, NoScene, Scene, write_scene
from .ports import (
    AgentRunRecord,
    IllustrationDone,
    IllustrationStore,
    IllustrationWork,
    NewImage,
    RouteResolver,
    StorageFull,
    ToolConfig,
    ToolResolver,
)
from .prompts import PromptBook
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)

ASPECT = "landscape"  # 横版 3:2：铺满阅读页正文那一栏
# 带了参考图报这几种错时去掉参考图再试一次（多半是服务不支持带图的那个接口）
RETRY_WITHOUT_REFERENCES = frozenset({"http", "unsupported", "bad_response"})


@dataclass
class _Progress:
    """画到哪一步了：超时的时候也要把已经写好的画面描述和那次调用记下来。"""

    prompt: str | None = None
    run: AgentRunRecord | None = None


class IllustrationRunner:
    def __init__(
        self,
        *,
        store: IllustrationStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        tools: ToolResolver,
        http: httpx.AsyncClient,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self._tools = tools
        self._http = http
        self._clock = clock

    async def process(self, image_id: str) -> bool:
        """画一张。返回是否画好并存下了。"""
        work = await self._store.load(image_id)
        if work is None:
            return False
        remaining = time_left(work.age_s)
        if remaining <= 0:
            log.warning("illustration.failed", image_id=image_id, kind="timeout", stage="queued")
            await self._store.fail(work, "timeout")
            return False
        structlog.contextvars.bind_contextvars(playthrough_id=work.playthrough_id)
        progress = _Progress()
        try:
            async with asyncio.timeout(remaining):
                return await self._draw(work, progress)
        except TimeoutError:
            log.warning("illustration.failed", image_id=image_id, kind="timeout")
            await self._store.fail(work, "timeout", prompt=progress.prompt, run=progress.run)
            return False
        finally:
            structlog.contextvars.unbind_contextvars("playthrough_id")

    async def _draw(self, work: IllustrationWork, progress: _Progress) -> bool:
        started = self._clock()
        route = await self._routes.resolve(work.user_id, RouteTask.ILLUSTRATOR, work.playthrough_id)
        if route is None:
            return await self._fail(work, "route_missing", progress)
        steps = StepLog()
        try:
            scene = await write_scene(
                route,
                self._hub.adapter(route.provider),
                work,
                self._prompts.get(work.language),
                steps=steps,
            )
        except (ProviderError, LimiterTimeout, NoScene) as exc:
            error_class = (
                exc.error_class.value if isinstance(exc, ProviderError) else type(exc).__name__
            )
            progress.run = self._run(route, steps, started, error_class=error_class)
            return await self._fail(work, "model_failed", progress)
        progress.run = self._run(route, steps, started, scene=scene)
        prompt = scene.prompt
        hint = STYLE_HINTS.get(work.style)
        if hint:
            prompt = f"{prompt}\n\nStyle: {hint}."
        progress.prompt = prompt
        config = (await self._tools.resolve_tools(work.user_id)).image
        if config is None or config.provider not in IMAGE_PROTOCOLS:
            return await self._fail(work, "tool_missing", progress)
        protocol = IMAGE_PROTOCOLS[config.provider]
        references, referenced = await self._references(work, scene.people, protocol)
        meta = {
            "tool_route_id": config.route_id,
            "protocol": config.provider,
            "model": config.model,
            "aspect": ASPECT,
            "people": list(scene.people),
            "references": referenced,
        }
        try:
            results, used = await self._generate(protocol, config, prompt, references)
        except ImageError as exc:
            return await self._fail(work, exc.kind, progress, meta=meta)
        except httpx.HTTPError:
            return await self._fail(work, "network", progress, meta=meta)
        if not used:
            meta["references"] = []
        image = await self._first_usable(results)
        if image is None:
            return await self._fail(work, "bad_response", progress, meta=meta)
        try:
            saved = await self._store.commit(
                work, IllustrationDone(image=image, prompt=prompt, meta=meta, run=progress.run)
            )
        except StorageFull:
            return await self._fail(work, "storage_full", progress, meta=meta)
        log.info(
            "illustration.drawn" if saved else "illustration.stale",
            image_id=work.image_id,
            protocol=config.provider,
            references=len(meta["references"]),
            bytes=len(image.data),
            duration_ms=int((self._clock() - started) * 1000),
        )
        return saved

    async def _references(
        self, work: IllustrationWork, people: Sequence[str], protocol: ImageProtocol
    ) -> tuple[list[Reference], list[str]]:
        """画里的人的封面或头像，按画面描述里列出的顺序，最多带服务支持的张数。"""
        refs: list[Reference] = []
        names: list[str] = []
        by_name = {f.name: f for f in work.figures}
        for name in people:
            if len(refs) >= protocol.max_references:
                break
            figure = by_name.get(name)
            if figure is None or figure.blob_id is None:
                continue
            found = await self._store.image_bytes(work.user_id, figure.blob_id)
            if found is None:
                continue
            refs.append(Reference(data=found[0], mime=found[1]))
            names.append(name)
        return refs, names

    async def _generate(
        self,
        protocol: ImageProtocol,
        config: ToolConfig,
        prompt: str,
        references: list[Reference],
    ) -> tuple[list[GeneratedImage], bool]:
        """出一张图；返回结果和是不是带着参考图出的。"""
        image_config = ImageConfig(
            model=config.model,
            api_key=config.api_key,
            base_url=config.base_url,
            params=config.params,
        )
        if references:
            try:
                results = await protocol.generate(
                    self._http,
                    image_config,
                    prompt=prompt,
                    aspect=ASPECT,
                    count=1,
                    references=references,
                )
                return results, True
            except ImageError as exc:
                if exc.kind not in RETRY_WITHOUT_REFERENCES:
                    raise
                log.info("illustration.references_dropped", kind=exc.kind)
        results = await protocol.generate(
            self._http, image_config, prompt=prompt, aspect=ASPECT, count=1
        )
        return results, False

    async def _first_usable(self, results: Sequence[GeneratedImage]) -> NewImage | None:
        for result in results:
            try:
                data = (
                    result.data
                    if result.data is not None
                    else await download_image(self._http, result.url or "")
                )
                clean = await asyncio.to_thread(scene_image, data)
            except (WebError, CleanError, httpx.HTTPError):
                continue
            return NewImage(
                data=clean.data,
                mime=clean.mime,
                width=clean.width,
                height=clean.height,
                sha256=clean.sha256,
            )
        return None

    async def _fail(
        self,
        work: IllustrationWork,
        error: str,
        progress: _Progress,
        *,
        meta: dict[str, object] | None = None,
    ) -> bool:
        log.warning("illustration.failed", image_id=work.image_id, kind=error)
        await self._store.fail(work, error, prompt=progress.prompt, meta=meta, run=progress.run)
        return False

    def _run(
        self,
        route: ResolvedRoute,
        steps: StepLog,
        started: float,
        *,
        scene: Scene | None = None,
        error_class: str | None = None,
    ) -> AgentRunRecord:
        return AgentRunRecord(
            agent=AGENT,
            task=RouteTask.ILLUSTRATOR.value,
            status="ok" if scene is not None else "failed",
            provider=route.provider,
            model=route.model,
            prices=route.prices,
            prompt_hash=scene.prompt_hash if scene is not None else None,
            usage=steps.total_usage(),
            latency_ms=int((self._clock() - started) * 1000),
            error_class=error_class,
            result={"people": len(scene.people)} if scene is not None else {},
            steps=steps.steps,
        )
