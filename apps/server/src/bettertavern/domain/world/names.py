"""实体名称的归一化：用于唯一约束（name_norm）和别名匹配。

NFKC（全角转半角、兼容字符统一）→ 去掉空白与常见标点 → casefold。繁简统一需要词表，留给
别名索引（M2 的场景解析器）去做。
"""

from __future__ import annotations

import re
import unicodedata

_STRIP = re.compile(r"[\s　·•・\-_.,，。'\"“”‘’「」『』()（）\[\]【】]+")


def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKC", name)
    text = _STRIP.sub("", text)
    return text.casefold()


def clean_display_name(name: str, limit: int = 40) -> str:
    text = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name)).strip()
    return text[:limit]
