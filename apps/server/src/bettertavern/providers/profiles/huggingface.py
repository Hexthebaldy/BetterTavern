"""Hugging Face Inference Providers：OpenAI 兼容的路由，模型名可带后缀选择后端。

后缀：:fastest（默认）、:cheapest、:preferred、:<provider>。同一个 :fastest 可能随时间路由到
不同后端，能力也会变，所以 HF 默认只走最保守的结构化方式，靠探测和负缓存调整。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from ..base import ModelInfo
from ..profile import ProviderProfile


@dataclass(frozen=True)
class HuggingFaceProfile(ProviderProfile):
    def parse_model(self, item: Mapping[str, Any]) -> ModelInfo | None:
        info = super().parse_model(item)
        if info is None or info.context_window is not None:
            return info
        providers = item.get("providers")
        if isinstance(providers, list):
            windows: list[int] = []
            for backend in providers:
                length = backend.get("context_length") if isinstance(backend, Mapping) else None
                if isinstance(length, int) and length > 0:
                    windows.append(length)
            if windows:
                # 不同后端的窗口不同，取最小值更安全
                return ModelInfo(id=info.id, context_window=min(windows), owned_by=info.owned_by)
        return info


PROFILE = HuggingFaceProfile(
    id="huggingface",
    display_name="Hugging Face",
    default_base_url="https://router.huggingface.co/v1",
)
