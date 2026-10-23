"""工作台 agent 的搜索：按顺序找能用的搜索服务（docs/workbench.md 第 5 节）。

1. 用户自己配的搜索服务：出错照实报给 agent（Key 不对、额度用完，要用户自己去处理）；
2. 官方搜索（运营方的 Key，只用免费额度）：每个用户每天、全站每个月都有次数上限
   （WebStore.claim_platform_search），用完了就跳到下一层；服务商说额度用完或 Key 不对时也跳，
   并且这个 worker 一小时内不再试；
3. 维基百科：不用 Key，永远可用，按草稿的语言选站点。

搜索结果在 worker 内存里留 20 分钟（SearchMemo），同一个查询同时来几次只请求一次；
命中内存的不算官方搜索的次数。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal

import structlog

from bettertavern.providers.web import (
    WEB_PROVIDERS,
    WIKIPEDIA,
    SearchHit,
    WebConfig,
    WebError,
    WebProvider,
)
from bettertavern.runtime.ports import ResolvedTools, ToolConfig

if TYPE_CHECKING:
    from .card_maker_web import WebTools

log = structlog.get_logger(__name__)

MEMO_S = 20 * 60
# 官方搜索说额度用完、Key 不对以后，这么久之内不再试
COOLDOWN_S = 3600

# own：用户自己配的；platform：官方搜索；wiki：只有维基百科
SearchScope = Literal["own", "platform", "wiki"]
Source = Literal["own", "platform", "wikipedia"]


class SearchMemo:
    """搜索结果在内存里留 20 分钟；同一个查询同时来几次，只请求一次。整个 worker 共用一份。
    另外记着哪些服务暂时不要再试（cool）。"""

    def __init__(self, ttl_s: float = MEMO_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._done: dict[tuple[str, ...], tuple[float, Any]] = {}
        self._pending: dict[tuple[str, ...], asyncio.Future[Any]] = {}
        self._cooling: dict[str, float] = {}

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

    def cooling(self, service: str) -> bool:
        until = self._cooling.get(service)
        return until is not None and self._clock() < until

    def cool(self, service: str, seconds: float = COOLDOWN_S) -> None:
        self._cooling[service] = self._clock() + seconds


class _NoQuota(Exception):
    """这个用户今天、或者全站这个月的官方搜索次数用完了。"""


def web_config(config: ToolConfig) -> WebConfig:
    return WebConfig(api_key=config.api_key, base_url=config.base_url, params=config.params)


def _usable(config: ToolConfig | None) -> tuple[ToolConfig, WebProvider] | None:
    provider = WEB_PROVIDERS.get(config.provider) if config is not None else None
    if config is None or provider is None or not provider.can_search:
        return None
    return config, provider


def own_search(tools: ResolvedTools) -> tuple[ToolConfig, WebProvider] | None:
    """用户自己配的搜索服务（能搜的才算）。"""
    return _usable(tools.search)


def search_scope(tools: ResolvedTools) -> SearchScope:
    if own_search(tools) is not None:
        return "own"
    return "platform" if _usable(tools.platform_search) is not None else "wiki"


async def find(web: WebTools, query: str, count: int) -> tuple[list[SearchHit], Source]:
    """按顺序搜，返回（结果，用的是哪一层）。自己配的服务、维基百科出错时抛 WebError。"""
    own = own_search(web.tools)
    if own is not None:
        config, provider = own
        hits = await web.memo.get(
            ("search", config.route_id, query, str(count)),
            lambda: provider.search(web.client, web_config(config), query, count),
        )
        return hits, "own"

    platform = _usable(web.tools.platform_search)
    if platform is not None and not web.memo.cooling(platform[0].route_id):
        config, provider = platform

        async def load() -> list[SearchHit]:
            if not await web.store.claim_platform_search(web.run.user_id):
                raise _NoQuota
            return await provider.search(web.client, web_config(config), query, count)

        try:
            hits = await web.memo.get(("search", config.route_id, query, str(count)), load)
            return hits, "platform"
        except _NoQuota:
            log.info("workbench.platform_search_used_up")
        except WebError as exc:
            log.warning("workbench.platform_search_failed", kind=exc.kind)
            if exc.kind in ("quota", "auth"):
                web.memo.cool(config.route_id)

    lang = web.run.language
    wiki = WebConfig(params={"lang": lang})
    hits = await web.memo.get(
        ("search", WIKIPEDIA.id, lang, query, str(count)),
        lambda: WIKIPEDIA.search(web.client, wiki, query, count),
    )
    return hits, "wikipedia"
