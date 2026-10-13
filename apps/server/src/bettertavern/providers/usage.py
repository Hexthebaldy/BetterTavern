"""把各家的 usage 字段归一成 Usage(prompt, completion, cached, reasoning)。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .base import Usage


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return 0
    return max(int(value), 0)


def _details(raw: Mapping[str, Any], *keys: str) -> Mapping[str, Any]:
    for key in keys:
        value = raw.get(key)
        if isinstance(value, Mapping):
            return value
    return {}


def normalize_usage(raw: Mapping[str, Any] | None) -> Usage | None:
    if not raw or not isinstance(raw, Mapping):
        return None
    prompt = _count(raw.get("prompt_tokens", raw.get("input_tokens")))
    completion = _count(raw.get("completion_tokens", raw.get("output_tokens")))
    if "prompt_cache_hit_tokens" in raw:  # DeepSeek
        cached = _count(raw.get("prompt_cache_hit_tokens"))
    else:
        cached = _count(
            _details(raw, "prompt_tokens_details", "input_tokens_details").get("cached_tokens")
        )
    reasoning = _count(
        _details(raw, "completion_tokens_details", "output_tokens_details").get("reasoning_tokens")
    )
    return Usage(prompt=prompt, completion=completion, cached=cached, reasoning=reasoning)
