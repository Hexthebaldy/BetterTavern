"""找出一段文字里提到了哪些实体：把名字和别名逐个在文字里找
（docs/agent-runtime.md 第 7 节“状态块”）。

文字和名字都先做同样的归一化（names.normalize_name），所以全角半角、空格、标点、大小写不影响匹配。
一局只有几十到几百个实体，逐个比对就够快，结果是确定的。只有一个字的名字不参与匹配，免得误中。
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Protocol

from .names import normalize_name

MIN_NAME_CHARS = 2


class Named(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def aliases(self) -> Sequence[str]: ...


def name_keys(entity: Named) -> list[str]:
    """一个实体的名字和别名归一化后的形式，太短的去掉。"""
    keys = [normalize_name(entity.name), *(normalize_name(a) for a in entity.aliases)]
    return [k for k in dict.fromkeys(keys) if len(k) >= MIN_NAME_CHARS]


def mentioned[T: Named](entities: Iterable[T], texts: Iterable[str]) -> list[T]:
    """在 texts 里出现了名字或别名的实体，保持 entities 的顺序。"""
    haystack = "\n".join(normalize_name(t) for t in texts if t)
    if not haystack:
        return []
    return [e for e in entities if any(k in haystack for k in name_keys(e))]
