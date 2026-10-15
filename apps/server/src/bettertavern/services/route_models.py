"""服务商的模型列表：拉取、短时缓存、标出每个模型的上下文窗口从哪来。

添加模型的表单先用还没保存的 Key 拉一次列表，几秒后保存时服务端还要用同一份列表确定窗口，
所以按（服务商、端点、Key）缓存 10 分钟，省掉第二次请求。缓存只在本进程内存里。
"""

from __future__ import annotations

import hashlib
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass

from bettertavern.providers import ModelInfo, ProviderHub, ResolvedCredential

CACHE_TTL_S = 600.0
CACHE_MAX = 64


@dataclass(frozen=True, slots=True)
class ListedModel:
    id: str
    context_window: int | None
    # listed：服务商的列表给的；table：列表没给，内置能力表知道；None：都不知道
    window_source: str | None
    owned_by: str | None


def _cache_key(cred: ResolvedCredential) -> str:
    raw = f"{cred.provider}\0{cred.base_url or ''}\0{cred.api_key.reveal()}"
    return hashlib.sha256(raw.encode()).hexdigest()


class ModelLister:
    def __init__(self, hub: ProviderHub, clock: Callable[[], float] = time.monotonic) -> None:
        self._hub = hub
        self._clock = clock
        self._cache: OrderedDict[str, tuple[float, list[ModelInfo]]] = OrderedDict()

    async def fetch(self, cred: ResolvedCredential) -> list[ModelInfo]:
        """请求服务商的模型列表并缓存；出错时抛 ProviderError。"""
        models = await self._hub.adapter(cred.provider).list_models(cred)
        key = _cache_key(cred)
        self._cache[key] = (self._clock() + CACHE_TTL_S, models)
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_MAX:
            self._cache.popitem(last=False)
        return models

    def cached(self, cred: ResolvedCredential) -> list[ModelInfo] | None:
        entry = self._cache.get(_cache_key(cred))
        if entry is None or entry[0] < self._clock():
            return None
        return entry[1]

    def window_of(self, provider: str, models: list[ModelInfo], model: str) -> int | None:
        return self._hub.registry.get(provider).window_of(models, model)

    def annotate(self, provider: str, models: list[ModelInfo]) -> list[ListedModel]:
        out: list[ListedModel] = []
        for m in models:
            window, source = m.context_window, "listed" if m.context_window else None
            if window is None:
                window = self._hub.capabilities(provider, m.id).context_window
                source = "table" if window else None
            out.append(
                ListedModel(
                    id=m.id, context_window=window, window_source=source, owned_by=m.owned_by
                )
            )
        return out
