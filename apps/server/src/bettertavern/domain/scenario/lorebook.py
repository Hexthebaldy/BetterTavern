"""独立的世界书（世界书仓库里的一本，docs/lorebook.md）：上限、导入报告、编辑条目，以及关键词的写法。

条目的结构和卡里的世界书一样（card.py 的 LoreEntry），校验也共用（edit.py 的 edit_entry）。
编辑世界书和工作台的草稿一样宽松：标题、正文、关键词可以暂时空着（这样的条目不会被带上，
编辑页标出来）；超过上限就拒绝并指出是哪个字段，不截断。
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict

from .card import LoreEntry
from .edit import EditError, LoreEntryEdit, edit_entry

MAX_LOREBOOK_ENTRIES = 2000
MAX_LOREBOOK_CHARS = 500_000  # 所有条目正文加起来
MAX_LOREBOOK_NAME_CHARS = 80
MAX_LOREBOOK_DESCRIPTION_CHARS = 2000
MAX_LOREBOOKS_PER_SCENARIO = 4


class LorebookReport(BaseModel):
    """导入报告：只有数字，不记内容（docs/lorebook.md 第 6.3 节）。"""

    model_config = ConfigDict(frozen=True)

    entries: int = 0  # 导进来几条
    constant: int = 0
    disabled: int = 0
    dropped_empty: int = 0  # 没有正文
    dropped_unreachable: int = 0  # 没有关键词又不是常驻，永远不会被带上
    dropped_over_limit: int = 0  # 超过条数上限
    vectorized: int = 0  # 按意思匹配：我们只看关键词
    character_filter: int = 0  # 只对某些角色生效：不生效
    bad_regex: int = 0  # 正则写错或用了不认的写法：那个关键词不会命中
    other_macros: int = 0  # 用了 {{user}}、{{char}} 以外的宏：开局时删掉


def book_chars(book: Iterable[LoreEntry]) -> int:
    return sum(len(e.content) for e in book)


def never_triggers(entry: LoreEntry) -> bool:
    """正文是空的，或者没有关键词又不是常驻：怎么都不会被带上。"""
    return not entry.content.strip() or (not entry.constant and not entry.keys)


def edit_book(entries: Sequence[LoreEntryEdit]) -> tuple[LoreEntry, ...]:
    """编辑一本世界书的全部条目（宽松模式）；超过上限抛 EditError。"""
    if len(entries) > MAX_LOREBOOK_ENTRIES:
        raise EditError("book", f"The lorebook can have at most {MAX_LOREBOOK_ENTRIES} entries")
    book = tuple(edit_entry(i, entry, lenient=True) for i, entry in enumerate(entries))
    total = book_chars(book)
    if total > MAX_LOREBOOK_CHARS:
        raise EditError(
            "book",
            f"The lorebook can have at most {MAX_LOREBOOK_CHARS} characters in total (now {total})",
        )
    return book


# ---- 关键词的写法 -------------------------------------------------------------------------

# ST 的正则关键词写成 /……/flags（public/scripts/world-info.js 的 parseRegexFromString）
_REGEX_KEY = re.compile(r"^/([\s\S]+?)/([gimsuy]*)$")
_UNESCAPED_SLASH = re.compile(r"(^|[^\\])/")
_MACRO = re.compile(r"\{\{\s*([^{}]{0,40}?)\s*\}\}")
_KNOWN_MACROS = {"user", "char"}


@dataclass(frozen=True, slots=True)
class RegexKey:
    """一个写成正则的关键词。编译用 regex 库（能设超时），domain 里只拆写法、不编译。"""

    pattern: str
    ignore_case: bool
    dotall: bool
    multiline: bool


def regex_key(key: str) -> RegexKey | None:
    """/……/flags 形式的关键词拆成正则和开关；不是这种写法返回 None。
    和 ST 一样：正则中间有没转义的 / 就不算正则；g、y、u 不影响是否命中，忽略。"""
    match = _REGEX_KEY.match(key)
    if match is None:
        return None
    pattern, flags = match.groups()
    if _UNESCAPED_SLASH.search(pattern):
        return None
    return RegexKey(
        pattern=pattern, ignore_case="i" in flags, dotall="s" in flags, multiline="m" in flags
    )


def has_other_macros(text: str) -> bool:
    """用了 {{user}}、{{char}} 以外的宏（{{random}} 之类，开局时会被删掉）。"""
    return any(m.group(1).strip().lower() not in _KNOWN_MACROS for m in _MACRO.finditer(text))
