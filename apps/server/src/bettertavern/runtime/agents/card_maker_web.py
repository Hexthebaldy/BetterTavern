"""工作台 agent 的联网和出图工具（docs/workbench.md 第 5、6 节，照 hermes agent 的做法）。

- web_search 只给标题、地址、摘要；结果在 worker 内存里留 20 分钟，同一个查询同时来几次只花一次钱；
- web_fetch 一次最多 5 个地址。每个地址依次过：地址里带着像 Key 的东西就拒绝 →
  防内网访问的静态检查 →
  web_pages 缓存（24 小时）→ 服务器自己读 → 读出来是空的或被拒时，配了读网页的服务商就换它再读。
  每页给模型最多 12000 字，超长的保留开头和结尾，中间用 read_page 按行读；
- 网页内容一律当资料：交回模型前过 sanitize_for_fence、包进 <recall>（读工具）；
- save_image、generate_image 下载的图都走防内网访问的网络层，解码、去 EXIF 后才存；
- 出图只在确认的方案里写了生成时能用，张数不超过方案里写的。
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx

from bettertavern.importers.images import ImageError as CleanError
from bettertavern.importers.images import clean_image
from bettertavern.providers.errors import EndpointNotAllowed
from bettertavern.providers.image import (
    IMAGE_PROTOCOLS,
    STYLE_HINTS,
    ImageConfig,
    ImageError,
    Reference,
)
from bettertavern.providers.transport import EndpointPolicy, check_url
from bettertavern.providers.web import (
    MAX_DOWNLOAD_BYTES,
    WEB_PROVIDERS,
    Page,
    WebConfig,
    WebError,
    clip_page,
    download_image,
    fetch_page,
    read_lines,
    secret_in_url,
)
from bettertavern.runtime.agent import Tool
from bettertavern.runtime.ports import NewImage, ResolvedTools, ToolConfig, WebStore, WorkbenchRun

from .card_maker_tools import MAX_PAGES, MAX_SEARCHES, CardMakerContext, to_json

PAGE_CHARS = 12_000
MAX_FETCH_URLS = 5
MAX_READ_LINES = 400
CACHE_S = 24 * 3600
MEMO_S = 20 * 60


class SearchMemo:
    """搜索结果在内存里留 20 分钟；同一个查询同时来几次，只请求一次。整个 worker 共用一份。"""

    def __init__(self, ttl_s: float = MEMO_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._done: dict[tuple[str, ...], tuple[float, Any]] = {}
        self._pending: dict[tuple[str, ...], asyncio.Future[Any]] = {}

    async def get(self, key: tuple[str, ...], load: Callable[[], Any]) -> Any:
        now = self._clock()
        hit = self._done.get(key)
        if hit is not None and now - hit[0] < self._ttl:
            return hit[1]
        pending = self._pending.get(key)
        if pending is not None:
            return await asyncio.shield(pending)
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[key] = future
        try:
            value = await load()
        except BaseException as exc:
            future.set_exception(exc)
            future.exception()  # 没人等时不报“异常没取走”
            raise
        finally:
            self._pending.pop(key, None)
        future.set_result(value)
        self._done[key] = (now, value)  # 只缓存成功的结果
        if len(self._done) > 500:
            oldest = sorted(self._done.items(), key=lambda kv: kv[1][0])[:100]
            for k, _ in oldest:
                self._done.pop(k, None)
        return value


@dataclass
class WebTools:
    run: WorkbenchRun
    tools: ResolvedTools
    store: WebStore
    client: httpx.AsyncClient
    policy: EndpointPolicy
    memo: SearchMemo
    searches: list[str] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)

    @property
    def can_search(self) -> bool:
        config = self.tools.search
        return config is not None and WEB_PROVIDERS.get(config.provider) is not None

    @property
    def can_images(self) -> bool:
        config = self.tools.search
        provider = WEB_PROVIDERS.get(config.provider) if config is not None else None
        return provider is not None and provider.can_images

    @property
    def can_generate(self) -> bool:
        config = self.tools.image
        return config is not None and config.provider in IMAGE_PROTOCOLS

    def tool_list(self) -> list[Tool]:
        return list(WEB_TOOLS)


def _config(config: ToolConfig) -> WebConfig:
    return WebConfig(api_key=config.api_key, base_url=config.base_url, params=config.params)


def _web(ctx: CardMakerContext) -> WebTools:
    web = ctx.web
    if not isinstance(web, WebTools):
        raise ctx.fail("no_search")
    return web


def url_hash(url: str) -> str:
    return hashlib.sha256(url.strip().encode()).hexdigest()


async def _researching(ctx: CardMakerContext, web: WebTools) -> None:
    """沟通阶段第一次查资料时，进度条走到“资料”。"""
    if ctx.mode == "planning" and not web.searches and not web.pages:
        await ctx.store.set_stage(ctx.run.draft_id, ctx.run.run_id, "research")


# ---- 搜索 ---------------------------------------------------------------------------------


async def web_search(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    config = web.tools.search
    if config is None or not web.can_search:
        raise ctx.fail("no_search")
    ctx.limits.searches += 1
    if ctx.limits.searches > MAX_SEARCHES:
        raise ctx.fail("limit_searches", max=MAX_SEARCHES)
    query = str(args["query"]).strip()[:300]
    count = max(1, min(int(args.get("count") or 8), 10))
    provider = WEB_PROVIDERS[config.provider]
    await _researching(ctx, web)
    await ctx.events.event("tool", {"name": "web_search", "state": "start", "query": query})
    try:
        hits = await web.memo.get(
            ("search", config.route_id, query, str(count)),
            lambda: provider.search(web.client, _config(config), query, count),
        )
    except WebError as exc:
        raise ctx.fail("search_failed", detail=exc.message) from exc
    web.searches.append(query)
    return to_json([{"title": h.title, "url": h.url, "snippet": h.snippet} for h in hits])


async def image_search(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    config = web.tools.search
    if config is None or not web.can_images:
        raise ctx.fail("no_search")
    ctx.limits.searches += 1
    if ctx.limits.searches > MAX_SEARCHES:
        raise ctx.fail("limit_searches", max=MAX_SEARCHES)
    query = str(args["query"]).strip()[:300]
    count = max(1, min(int(args.get("count") or 8), 10))
    provider = WEB_PROVIDERS[config.provider]
    await ctx.events.event("tool", {"name": "image_search", "state": "start", "query": query})
    try:
        hits = await web.memo.get(
            ("images", config.route_id, query, str(count)),
            lambda: provider.images(web.client, _config(config), query, count),
        )
    except WebError as exc:
        raise ctx.fail("search_failed", detail=exc.message) from exc
    web.searches.append(query)
    return to_json(
        [
            {
                "image_url": h.image_url,
                "page_url": h.page_url,
                "title": h.title,
                "size": f"{h.width}x{h.height}" if h.width and h.height else "",
                "license": h.license,
            }
            for h in hits
        ]
    )


# ---- 读网页 -------------------------------------------------------------------------------


async def _read_one(web: WebTools, url: str) -> tuple[str, Page]:
    """读一个地址，返回（页面编号，页面）。不合格的地址、读不了的页面抛 WebError。"""
    if secret_in_url(url):
        raise WebError("blocked", "The address looks like it contains a key; not fetched")
    try:
        check_url(url, web.policy)
    except EndpointNotAllowed as exc:
        raise WebError("blocked", str(exc)) from exc
    digest = url_hash(url)
    cached = await web.store.cached_page(web.run.user_id, digest, max_age_s=CACHE_S)
    if cached is not None:
        return cached.id, Page(
            url=cached.url,
            final_url=cached.final_url or cached.url,
            title=cached.title,
            content=cached.content,
            fetcher=cached.fetcher,
        )
    page: Page | None = None
    error: WebError | None = None
    try:
        page = await fetch_page(web.client, url)
    except WebError as exc:
        error = exc
    fallback = web.tools.fetch
    if (
        page is None
        and fallback is not None
        and error is not None
        and error.kind
        in (
            "empty",
            "http",
            "network",
        )
    ):
        provider = WEB_PROVIDERS.get(fallback.provider)
        if provider is not None and provider.can_fetch:
            results = await provider.fetch(web.client, _config(fallback), [url])
            first = results[0] if results else WebError("empty", "No result")
            if isinstance(first, Page):
                page, error = first, None
            else:
                error = first
    if page is None:
        assert error is not None
        raise error
    page_id = await web.store.save_page(
        web.run.user_id,
        url=url,
        url_hash=digest,
        final_url=page.final_url,
        title=page.title,
        content=page.content[:2_000_000],
        fetcher=page.fetcher,
    )
    return page_id, page


async def web_fetch(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    urls = [str(u).strip() for u in args.get("urls") or [] if str(u).strip()][:MAX_FETCH_URLS]
    if not urls:
        raise ctx.fail("fetch_failed", detail="give at least one URL")
    await _researching(ctx, web)
    await ctx.events.event("tool", {"name": "web_fetch", "state": "start", "urls": len(urls)})
    hint = ctx.messages["page_more"]
    parts: list[str] = []
    for url in urls:
        ctx.limits.pages += 1
        if ctx.limits.pages > MAX_PAGES:
            parts.append(ctx.messages["limit_pages"].format(max=MAX_PAGES))
            break
        try:
            page_id, page = await _read_one(web, url)
        except WebError as exc:
            parts.append(f"=== {url}\n" + ctx.messages["fetch_failed"].format(detail=exc.message))
            continue
        web.pages.append(page_id)
        body = clip_page(page.content, PAGE_CHARS, page_id=page_id, more_hint=hint)
        title = f" {page.title}" if page.title else ""
        parts.append(f"=== [{page_id}]{title} ({page.final_url})\n{body}")
    return "\n\n".join(parts)


async def read_page(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    page_id = str(args["page_id"]).strip()
    page = await web.store.page(web.run.user_id, page_id) if _is_uuid(page_id) else None
    if page is None:
        raise ctx.fail("no_page", page_id=page_id)
    start = max(1, int(args.get("start") or 1))
    count = max(1, min(int(args.get("lines") or 200), MAX_READ_LINES))
    text, total = read_lines(page.content, start, count)
    end = min(start + count - 1, total)
    return f"[{page_id} {start}-{end}/{total}]\n{text}"


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True


async def save_note(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    text = str(args["text"]).replace("\x00", "").strip()[:2000]
    if not text:
        raise ctx.fail("bad_message", detail="the note is empty")
    url = str(args.get("url") or "").strip()[:2000]
    source = {"url": url, "title": str(args.get("title") or "").strip()[:200]}
    if url:
        with contextlib.suppress(httpx.InvalidURL, TypeError, ValueError):
            source["site"] = httpx.URL(url).host
    used_in = [str(u)[:40] for u in args.get("used_in") or []][:10]
    note_id = await web.store.add_note(web.run.draft_id, text=text, source=source, used_in=used_in)
    return ctx.messages["note_saved"].format(id=note_id)


# ---- 图片 ---------------------------------------------------------------------------------


def _new_image(data: bytes) -> NewImage:
    clean = clean_image(data, max_bytes=MAX_DOWNLOAD_BYTES)
    return NewImage(
        data=clean.data,
        mime=clean.mime,
        width=clean.width,
        height=clean.height,
        sha256=clean.sha256,
    )


async def save_image(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    url = str(args["url"]).strip()
    license_ = (
        args.get("license")
        if args.get("license") in ("public_domain", "copyrighted", "unknown")
        else "unknown"
    )
    if secret_in_url(url):
        raise ctx.fail("fetch_failed", detail="the address looks like it contains a key")
    try:
        check_url(url, web.policy)
        data = await download_image(web.client, url)
        image = await asyncio.to_thread(_new_image, data)
    except EndpointNotAllowed as exc:
        raise ctx.fail("fetch_failed", detail=str(exc)) from exc
    except WebError as exc:
        raise ctx.fail("fetch_failed", detail=exc.message) from exc
    except (httpx.HTTPError, CleanError) as exc:
        raise ctx.fail("fetch_failed", detail=str(exc) or type(exc).__name__) from exc
    asset = await web.store.add_image(
        web.run.user_id,
        web.run.draft_id,
        image,
        source="search",
        license=str(license_),
        source_url=url,
        meta={
            "page_url": str(args.get("page_url") or "")[:2000],
            "title": str(args.get("title") or "")[:200],
        },
    )
    ctx.assets[asset.id] = asset
    return ctx.messages["image_saved"].format(
        id=asset.id, license=asset.license, size=f"{asset.width}x{asset.height}"
    )


async def generate_image(args: Mapping[str, Any], ctx: CardMakerContext) -> str:
    ctx.count_call()
    web = _web(ctx)
    config = web.tools.image
    if config is None or not web.can_generate:
        raise ctx.fail("image_failed", detail="text-to-image isn't set up")
    remaining = ctx.limits.image_budget - ctx.limits.images
    if remaining <= 0:
        raise ctx.fail("limit_images", max=ctx.limits.image_budget)
    count = max(1, min(int(args.get("count") or 1), remaining, 4))
    aspect = (
        args.get("aspect")
        if args.get("aspect") in ("portrait", "square", "landscape")
        else "portrait"
    )
    style = str(args.get("style") or "").strip()
    prompt = str(args["prompt"]).strip()[:4000]
    if style:
        prompt = f"{prompt}\n\nStyle: {STYLE_HINTS.get(style, style)}."
    references = [
        ref
        for ref in await _references(web, args.get("reference_asset_ids") or [], ctx)
        if ref is not None
    ]
    protocol = IMAGE_PROTOCOLS[config.provider]
    await ctx.events.event("tool", {"name": "generate_image", "state": "start", "count": count})
    ctx.limits.images += count
    try:
        results = await protocol.generate(
            web.client,
            ImageConfig(
                model=config.model,
                api_key=config.api_key,
                base_url=config.base_url,
                params=config.params,
            ),
            prompt=prompt,
            aspect=aspect,  # type: ignore[arg-type]
            count=count,
            references=references[: protocol.max_references],
        )
    except ImageError as exc:
        raise ctx.fail("image_failed", detail=exc.message) from exc
    except httpx.HTTPError as exc:
        raise ctx.fail("image_failed", detail=type(exc).__name__) from exc
    ids: list[str] = []
    for result in results[:count]:
        try:
            data = (
                result.data
                if result.data is not None
                else await download_image(web.client, result.url or "")
            )
            image = await asyncio.to_thread(_new_image, data)
        except (WebError, CleanError, httpx.HTTPError):
            continue
        asset = await web.store.add_image(
            web.run.user_id,
            web.run.draft_id,
            image,
            source="generated",
            license="own",
            prompt=prompt,
            meta={
                "tool_route_id": config.route_id,
                "protocol": config.provider,
                "model": config.model,
                "aspect": aspect,
                "style": style,
            },
        )
        ctx.assets[asset.id] = asset
        ids.append(asset.id)
    if not ids:
        raise ctx.fail("image_failed", detail="no usable image came back")
    return ctx.messages["images_generated"].format(ids=", ".join(ids))


async def _references(
    web: WebTools, ids: Sequence[Any], ctx: CardMakerContext
) -> list[Reference | None]:
    """参考图：只用草稿里版权没问题的图（公有领域、生成的、上传的、卡自带的）。"""
    refs: list[Reference | None] = []
    for asset_id in list(ids)[:3]:
        asset = ctx.assets.get(str(asset_id))
        if asset is None or asset.license not in ("public_domain", "own"):
            continue
        found = await web.store.image_bytes(web.run.user_id, asset.blob_id)
        refs.append(Reference(data=found[0], mime=found[1]) if found is not None else None)
    return refs


_STRING = {"type": "string"}

WEB_TOOLS: tuple[Tool, ...] = (
    Tool(
        name="web_search",
        kind="read",
        parameters={
            "type": "object",
            "properties": {"query": _STRING, "count": {"type": "integer"}},
            "required": ["query"],
        },
        handler=web_search,
        max_result_chars=8000,
    ),
    Tool(
        name="image_search",
        kind="read",
        parameters={
            "type": "object",
            "properties": {"query": _STRING, "count": {"type": "integer"}},
            "required": ["query"],
        },
        handler=image_search,
        max_result_chars=8000,
    ),
    Tool(
        name="web_fetch",
        kind="read",
        parameters={
            "type": "object",
            "properties": {"urls": {"type": "array", "items": _STRING}},
            "required": ["urls"],
        },
        handler=web_fetch,
        max_result_chars=PAGE_CHARS * MAX_FETCH_URLS + 4000,
    ),
    Tool(
        name="read_page",
        kind="read",
        parameters={
            "type": "object",
            "properties": {
                "page_id": _STRING,
                "start": {"type": "integer"},
                "lines": {"type": "integer"},
            },
            "required": ["page_id"],
        },
        handler=read_page,
        max_result_chars=40000,
    ),
    Tool(
        name="save_note",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "text": _STRING,
                "url": _STRING,
                "title": _STRING,
                "used_in": {"type": "array", "items": _STRING},
            },
            "required": ["text"],
        },
        handler=save_note,
    ),
    Tool(
        name="save_image",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "url": _STRING,
                "page_url": _STRING,
                "title": _STRING,
                "license": {"type": "string", "enum": ["public_domain", "copyrighted", "unknown"]},
            },
            "required": ["url", "license"],
        },
        handler=save_image,
    ),
    Tool(
        name="generate_image",
        kind="write",
        parameters={
            "type": "object",
            "properties": {
                "prompt": _STRING,
                "style": _STRING,
                "aspect": {"type": "string", "enum": ["portrait", "square", "landscape"]},
                "count": {"type": "integer"},
                "reference_asset_ids": {"type": "array", "items": _STRING},
            },
            "required": ["prompt"],
        },
        handler=generate_image,
    ),
)
