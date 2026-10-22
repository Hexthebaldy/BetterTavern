"""改动对比（docs/workbench.md 第 3.7 节“改动的对比”）：写好以后接着改、改仓库里已有的卡时，
agent 不直接写，而是给出一处处改动，用户“全部采用 / 逐条看 / 都不要”。

- 每一处（hunk）记下改前的原文（由代码从草稿里取，不用模型给的）；
- 采用时先检查草稿里那一处现在还是不是改前的样子：是就写入；
  不是（比如用户手动改过）就标成 stale，不写；
- 目标有三种：文本字段（含角色名）、备选开场白（编号从 1 起，等于现有条数加 1 是新加一条）、
  世界书条目（编号是按顺序排好以后的位置；新加一条用 lore_new）。
  after 为 null 表示删掉那条开场白或条目。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry
from bettertavern.domain.scenario.edit import EDITABLE_TEXT_FIELDS, book_in_order

MAX_HUNKS = 20
MAX_SUMMARY_CHARS = 120
TEXT_TARGETS = ("name", *EDITABLE_TEXT_FIELDS)

HunkState = Literal["pending", "accepted", "rejected", "stale"]


class ChangeError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProposedChange:
    """agent 提的一处改动（还没取改前的原文）。"""

    target: Mapping[str, Any]
    after: str | None
    summary: str = ""


def _clean(text: str) -> str:
    return text.replace("\x00", "").replace("\r\n", "\n").strip()


def _current(card: CharacterCard, target: Mapping[str, Any]) -> str | None:
    """目标现在的内容；新加的（开场白、条目）是空串；目标不存在返回 None。"""
    if "field" in target:
        field = target["field"]
        if field not in TEXT_TARGETS:
            return None
        return str(getattr(card, field))
    if "greeting" in target:
        index = target["greeting"]
        if not isinstance(index, int) or isinstance(index, bool) or index < 1:
            return None
        greetings = card.alternate_greetings
        if index <= len(greetings):
            return greetings[index - 1]
        return "" if index == len(greetings) + 1 else None
    if "lore" in target:
        index = target["lore"]
        book = book_in_order(card.book)
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(book):
            return None
        return book[index].content
    if "lore_new" in target:
        return ""
    return None


def build_hunks(card: CharacterCard, proposed: Sequence[ProposedChange]) -> list[dict[str, Any]]:
    """把 agent 提的改动整理成对比：补上改前的原文，去掉没有变化的；目标不存在时抛 ChangeError。"""
    if not proposed:
        raise ChangeError("propose at least one change")
    if len(proposed) > MAX_HUNKS:
        raise ChangeError(f"at most {MAX_HUNKS} changes at a time")
    hunks: list[dict[str, Any]] = []
    for index, change in enumerate(proposed):
        target = dict(change.target)
        before = _current(card, target)
        if before is None:
            raise ChangeError(f"change {index + 1}: no such place in the card ({target})")
        after = None if change.after is None else _clean(change.after)
        if after is None and not ("greeting" in target or "lore" in target):
            raise ChangeError(f"change {index + 1}: only greetings and lore entries can be deleted")
        if after is not None and after == before:
            continue
        if "lore_new" in target:
            spec = target["lore_new"] if isinstance(target["lore_new"], Mapping) else {}
            target = {
                "lore_new": {
                    "name": _clean(str(spec.get("name") or ""))[:120],
                    "keys": [
                        _clean(str(k))[:100] for k in spec.get("keys") or [] if str(k).strip()
                    ][:64],
                    "constant": bool(spec.get("constant", False)),
                }
            }
        hunks.append(
            {
                "id": f"h{len(hunks) + 1}",
                "target": target,
                "before": before,
                "after": after,
                "summary": _clean(change.summary)[:MAX_SUMMARY_CHARS],
                "state": "pending",
            }
        )
    if not hunks:
        raise ChangeError("none of the changes differ from the current card")
    return hunks


def apply_hunks(
    card: CharacterCard, hunks: Sequence[Mapping[str, Any]], accept: set[str]
) -> tuple[CharacterCard, list[dict[str, Any]]]:
    """采用 accept 里的几处（还是 pending 的才算），其余 pending 的标成 rejected。
    返回新卡片和更新了 state 的 hunks。删除放在最后、按编号从大到小做，免得编号错位。"""
    texts: dict[str, str] = {}
    greetings = list(card.alternate_greetings)
    book = list(book_in_order(card.book))
    deleted_greetings: list[int] = []
    deleted_lore: list[int] = []
    added_lore: list[LoreEntry] = []
    result: list[dict[str, Any]] = []
    for hunk in hunks:
        updated = dict(hunk)
        if hunk.get("state") != "pending":
            result.append(updated)
            continue
        if hunk["id"] not in accept:
            updated["state"] = "rejected"
            result.append(updated)
            continue
        target = hunk["target"]
        now = _current(card, target)
        if now is None or now != hunk["before"]:
            updated["state"] = "stale"
            result.append(updated)
            continue
        after = hunk["after"]
        if "field" in target:
            texts[target["field"]] = after or ""
        elif "greeting" in target:
            index = target["greeting"]
            if after is None:
                deleted_greetings.append(index - 1)
            elif index <= len(card.alternate_greetings):
                greetings[index - 1] = after
            else:
                greetings.append(after)
        elif "lore" in target:
            index = target["lore"]
            if after is None:
                deleted_lore.append(index)
            else:
                book[index] = book[index].model_copy(update={"content": after})
        elif "lore_new" in target and after:
            spec = target["lore_new"]
            added_lore.append(
                LoreEntry(
                    name=str(spec.get("name") or ""),
                    keys=tuple(spec.get("keys") or ()),
                    content=after,
                    constant=bool(spec.get("constant", False)),
                )
            )
        updated["state"] = "accepted"
        result.append(updated)
    for index in sorted(set(deleted_greetings), reverse=True):
        del greetings[index]
    for index in sorted(set(deleted_lore), reverse=True):
        del book[index]
    book.extend(added_lore)
    renumbered = tuple(e.model_copy(update={"order": i}) for i, e in enumerate(book))
    changed = card.model_copy(
        update={**texts, "alternate_greetings": tuple(greetings), "book": renumbered}
    )
    still_truncated = tuple(f for f in card.truncated if getattr(changed, f) == getattr(card, f))
    return changed.model_copy(update={"truncated": still_truncated}), result
