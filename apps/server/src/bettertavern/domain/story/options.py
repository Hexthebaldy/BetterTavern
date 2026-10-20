"""选项规范：每轮恰好 2 个，互不重复，每个不超过上限字数。"""

from __future__ import annotations

import re
from collections.abc import Iterable

OPTION_COUNT = 2
# 提示词要求每项不超过 30 字；解析时放宽，超过这个长度才视为无效
MAX_OPTION_CHARS = 80

_QUOTE_PAIRS = {'"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』"}
_WHITESPACE = re.compile(r"\s+")


def clean_option(text: str) -> str | None:
    value = text.strip().strip("*_").strip()
    if len(value) >= 2 and _QUOTE_PAIRS.get(value[0]) == value[-1]:
        value = value[1:-1].strip()
    value = _WHITESPACE.sub(" ", value)
    if not value or len(value) > MAX_OPTION_CHARS:
        return None
    return value


def normalize_options(raw: Iterable[str], limit: int | None = None) -> list[str]:
    """清理、去重（不区分大小写），保持原顺序；limit 为 None 时不截断。"""
    seen: set[str] = set()
    result: list[str] = []
    for item in raw:
        cleaned = clean_option(item)
        if cleaned is None:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
        if limit is not None and len(result) >= limit:
            break
    return result
