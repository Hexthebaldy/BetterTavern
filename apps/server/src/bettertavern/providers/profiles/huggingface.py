"""Hugging Face Inference Providers：OpenAI 兼容的路由，模型名可带后缀选择后端。

后缀：:fastest（默认）、:cheapest、:preferred、:<provider>。同一个 :fastest 可能随时间路由到
不同后端，能力也会变，所以 HF 默认只走最保守的结构化方式，靠探测和负缓存调整。

模型列表里每个模型列出了提供它的各家后端和各自的上下文长度（不少后端为了省显存只开 32K）。
模型名指定了后端（:novita）就用那一家的长度；没指定或用的是策略后缀时可能被分到任何一家，取最小的。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ..base import ModelInfo
from ..profile import ProviderProfile

# 按策略选后端的后缀，不是某一家后端的名字
_POLICY_SUFFIXES = frozenset({"fastest", "cheapest", "preferred"})


@dataclass(frozen=True)
class HuggingFaceProfile(ProviderProfile):
    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        info = super().parse_model(item)
        if info is None:
            return None
        backends: dict[str, int] = {}
        providers = item.get("providers")
        if isinstance(providers, list):
            for backend in providers:
                if not isinstance(backend, Mapping):
                    continue
                length = backend.get("context_length")
                name = backend.get("provider")
                if isinstance(length, int) and length > 0:
                    backends[name if isinstance(name, str) and name else f"#{len(backends)}"] = (
                        length
                    )
        if info.context_window is None and backends:
            info = ModelInfo(
                id=info.id, context_window=min(backends.values()), owned_by=info.owned_by
            )
        return ModelInfo(
            id=info.id,
            context_window=info.context_window,
            owned_by=info.owned_by,
            backend_windows=backends,
        )

    def window_of(self, models: Sequence[ModelInfo], model: str) -> int | None:
        base, _, suffix = model.partition(":")
        for info in models:
            if info.id != base:
                continue
            if suffix and suffix not in _POLICY_SUFFIXES and suffix in info.backend_windows:
                return info.backend_windows[suffix]
            return info.context_window
        return None


PROFILE = HuggingFaceProfile(
    id="huggingface",
    display_name="Hugging Face",
    default_base_url="https://router.huggingface.co/v1",
)
