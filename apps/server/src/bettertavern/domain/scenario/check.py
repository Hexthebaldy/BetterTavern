"""保存前的检查：工作台“保存到角色卡仓库”、agent 的 check_draft 工具和客户端的检查结果用同一套规则
（客户端的副本在 packages/core/src/scenario/cardEdit.ts，两边的 code 一致）。

- error：不能保存。名字为空、超长、条目内容为空等，和 edit.py 正式模式拒绝的情况一一对应；
- warning：能保存，但多半是写漏了。没有开场白、世界书条目永远触发不了、关键词重复、宏写错。

只看卡片本身，不看数据库；文字不进日志。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field as dc_field
from typing import Literal

from .card import MAX_BOOK_ENTRIES, MAX_FIELD_CHARS, MAX_TOTAL_CHARS, CharacterCard
from .edit import (
    EDITABLE_TEXT_FIELDS,
    MAX_ENTRY_NAME_CHARS,
    MAX_GREETINGS,
    MAX_KEY_CHARS,
    MAX_KEYS,
    MAX_NAME_CHARS,
    MAX_TAG_CHARS,
    MAX_TAGS,
    book_in_order,
)

Level = Literal["error", "warning"]

# {{user}}、{{char}} 以外的宏（{{random}} 之类）开局时会被丢掉；花括号不成对的多半是写错了
_MACRO = re.compile(r"\{\{\s*([^{}]{0,40}?)\s*\}\}")
_HALF_MACRO = re.compile(r"(?<!\{)\{\s*(user|char)\s*\}\}|\{\{\s*(user|char)\s*\}(?!\})", re.I)
_KNOWN_MACROS = {"user", "char"}


@dataclass(frozen=True, slots=True)
class Issue:
    field: (
        str  # 和 422 的 field 一样：name、description、book.3.content、alternate_greetings.1、card
    )
    code: str
    level: Level
    params: dict[str, object] = dc_field(default_factory=dict)


def _macro_issues(field_name: str, text: str) -> list[Issue]:
    issues: list[Issue] = []
    for match in _MACRO.finditer(text):
        name = match.group(1).strip().lower()
        if name not in _KNOWN_MACROS:
            issues.append(Issue(field_name, "macro_unknown", "warning", {"macro": match.group(0)}))
            break
    half = _HALF_MACRO.search(text)
    if half is not None:
        issues.append(Issue(field_name, "macro_broken", "warning", {"macro": half.group(0)}))
    return issues


def check_card(card: CharacterCard, *, display_name: str) -> list[Issue]:
    """按字段顺序返回所有问题；没有 error 才能保存。"""
    issues: list[Issue] = []

    def error(where: str, code: str, **params: object) -> None:
        issues.append(Issue(where, code, "error", params))

    def warn(where: str, code: str, **params: object) -> None:
        issues.append(Issue(where, code, "warning", params))

    shown = display_name.strip()
    if not shown:
        error("display_name", "display_name_empty")
    elif len(shown) > MAX_NAME_CHARS:
        error("display_name", "display_name_too_long", max=MAX_NAME_CHARS)
    name = card.name.strip()
    if not name:
        error("name", "name_empty")
    elif len(name) > MAX_NAME_CHARS:
        error("name", "name_too_long", max=MAX_NAME_CHARS)

    for name_ in EDITABLE_TEXT_FIELDS:
        text = getattr(card, name_)
        if len(text) > MAX_FIELD_CHARS:
            error(name_, "field_too_long", max=MAX_FIELD_CHARS, n=len(text))
        issues.extend(_macro_issues(name_, text))
    if not card.description.strip():
        warn("description", "description_empty")
    if not card.first_mes.strip():
        warn("first_mes", "opening_empty")

    if len(card.alternate_greetings) > MAX_GREETINGS:
        error("alternate_greetings", "too_many_greetings", max=MAX_GREETINGS)
    for index, greeting in enumerate(card.alternate_greetings):
        where = f"alternate_greetings.{index}"
        if not greeting.strip():
            error(where, "greeting_empty")
        elif len(greeting) > MAX_FIELD_CHARS:
            error(where, "field_too_long", max=MAX_FIELD_CHARS, n=len(greeting))
        issues.extend(_macro_issues(where, greeting))

    if len(card.tags) > MAX_TAGS:
        error("tags", "too_many_tags", max=MAX_TAGS)
    elif any(len(t) > MAX_TAG_CHARS for t in card.tags):
        error("tags", "tag_too_long", max=MAX_TAG_CHARS)

    book = book_in_order(card.book)
    if len(book) > MAX_BOOK_ENTRIES:
        error("book", "too_many_entries", max=MAX_BOOK_ENTRIES)
    seen_keys: dict[str, int] = {}
    for index, entry in enumerate(book):
        where = f"book.{index}"
        if len(entry.name) > MAX_ENTRY_NAME_CHARS:
            error(f"{where}.name", "entry_name_too_long", max=MAX_ENTRY_NAME_CHARS)
        if len(entry.keys) > MAX_KEYS:
            error(f"{where}.keys", "too_many_keys", max=MAX_KEYS)
        elif any(len(k) > MAX_KEY_CHARS for k in entry.keys):
            error(f"{where}.keys", "key_too_long", max=MAX_KEY_CHARS)
        if not entry.content.strip():
            error(f"{where}.content", "entry_empty")
        elif len(entry.content) > MAX_FIELD_CHARS:
            error(f"{where}.content", "field_too_long", max=MAX_FIELD_CHARS, n=len(entry.content))
        if entry.enabled and not entry.constant and not entry.keys:
            warn(f"{where}.keys", "entry_unreachable")
        for key in entry.keys:
            folded = key.casefold()
            if folded in seen_keys and seen_keys[folded] != index:
                warn(f"{where}.keys", "key_duplicate", key=key, other=seen_keys[folded] + 1)
                break
            seen_keys.setdefault(folded, index)

    total = card.total_chars()
    if total > MAX_TOTAL_CHARS:
        error("card", "total_too_long", max=MAX_TOTAL_CHARS, n=total)
    return issues


def blocking(issues: list[Issue]) -> list[Issue]:
    return [i for i in issues if i.level == "error"]
