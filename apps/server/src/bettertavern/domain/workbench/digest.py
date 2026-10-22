"""草稿的概况（给 agent 看，docs/workbench.md 第 4.4 节）和“用户手动改过哪些地方”。

概况只列各部分多长、开头几行、世界书有哪些条目，不放全文；要全文 agent 用 read_field 去读。
手动改过的地方：和 agent 上一轮结束时的样子（agent_baseline）比，哪些字段、哪几条开场白和条目变了。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.scenario.check import check_card
from bettertavern.domain.scenario.edit import EDITABLE_TEXT_FIELDS, book_in_order

HEAD_CHARS = 120


def _head(text: str) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= HEAD_CHARS else flat[:HEAD_CHARS] + "…"


def draft_digest(card: CharacterCard, *, display_name: str, has_cover: bool) -> dict[str, Any]:
    fields = {
        name: {"chars": len(getattr(card, name)), "head": _head(getattr(card, name))}
        for name in EDITABLE_TEXT_FIELDS
    }
    book = book_in_order(card.book)
    issues = check_card(card, display_name=display_name or card.name)
    return {
        "name": card.name,
        "display_name": display_name,
        "fields": fields,
        "alternate_greetings": [
            {"index": i + 1, "chars": len(g), "head": _head(g)}
            for i, g in enumerate(card.alternate_greetings)
        ],
        "tags": list(card.tags),
        "lore": [
            {
                "index": i,
                "name": e.name,
                "keys": list(e.keys),
                "constant": e.constant,
                "enabled": e.enabled,
                "chars": len(e.content),
            }
            for i, e in enumerate(book)
        ],
        "cover": has_cover,
        "total_chars": card.total_chars(),
        "issues": [{"field": i.field, "code": i.code, "level": i.level} for i in issues],
    }


def user_edits(
    card: CharacterCard, baseline: Mapping[str, Any] | None, *, display_name: str = ""
) -> list[str]:
    """和上一轮结束时比，用户改过的地方：字段名、greeting.{n}、lore.{名称}、tags。
    没有上一轮（baseline 为空）时返回空列表。"""
    if not baseline:
        return []
    try:
        before = CharacterCard.model_validate(baseline.get("card") or baseline)
    except ValueError:
        return []
    changed: list[str] = []
    if display_name and display_name != baseline.get("display_name", display_name):
        changed.append("display_name")
    for name in ("name", *EDITABLE_TEXT_FIELDS):
        if getattr(card, name) != getattr(before, name):
            changed.append(name)
    if card.tags != before.tags:
        changed.append("tags")
    old = list(before.alternate_greetings)
    for i, greeting in enumerate(card.alternate_greetings):
        if i >= len(old) or old[i] != greeting:
            changed.append(f"greeting.{i + 1}")
    if len(old) > len(card.alternate_greetings):
        changed.append("greetings_removed")
    old_book = {e.name: e for e in before.book}
    for entry in card.book:
        prior = old_book.pop(entry.name, None)
        if prior is None or (prior.content, prior.keys, prior.constant, prior.enabled) != (
            entry.content,
            entry.keys,
            entry.constant,
            entry.enabled,
        ):
            changed.append(f"lore.{entry.name}")
    changed.extend(f"lore_removed.{name}" for name in old_book)
    return changed


def is_complete(card: CharacterCard) -> bool:
    """草稿“写完了”：有名字、描述、开场白，而且没有挡住保存的问题。"""
    if not (card.name.strip() and card.description.strip() and card.first_mes.strip()):
        return False
    return not any(i.level == "error" for i in check_card(card, display_name=card.name))
