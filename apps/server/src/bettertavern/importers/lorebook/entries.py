"""世界书条目的映射（docs/lorebook.md 第 6 节）：SillyTavern 世界书文件（worlds/*.json）里的条目、
角色卡规范里 character_book 的条目 → LoreEntry。导入角色卡和导入独立世界书共用。

- character_book 的条目先照 ST 的 convertCharacterBook 换成世界书文件的字段名，再走同一套映射；
  ST 把自己的设置写在每条的 extensions 里
  （src/endpoints/characters.js 的 convertWorldInfoToCharacterBook）。
- 返回的条目 order 是“显示的先后”（displayIndex，没有就是在文件里的位置），由调用方排好再重新编号；
  priority 是 ST 的 order 数字。
- 粘滞、冷却、延迟在 ST 里按消息条数算，这里换成回合（除以 2 向上取整）。
- 内容开头的 @@activate、@@dont_activate（ST 的装饰写法）换成常驻、停用，这几行去掉。
- 正则关键词在这里试编译一遍，编不过的记进报告（runtime 里那个关键词就不会命中）。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import regex

from bettertavern.domain.scenario.card import (
    DEFAULT_PRIORITY,
    LORE_TRIGGERS,
    MAX_FIELD_CHARS,
    LoreEntry,
    LoreLogic,
    LoreMatch,
    LoreRules,
)
from bettertavern.domain.scenario.edit import (
    MAX_ENTRY_NAME_CHARS,
    MAX_KEY_CHARS,
    MAX_KEYS,
    MAX_PRIORITY,
)
from bettertavern.domain.scenario.lorebook import has_other_macros, regex_key

# ST 的 selectiveLogic：0 AND_ANY、1 NOT_ALL、2 NOT_ANY、3 AND_ALL
_LOGIC: dict[int, LoreLogic] = {0: "any", 1: "not_all", 2: "not_any", 3: "all"}
# 世界书文件里的字段 → 顺带扫描哪段文字
_MATCH_FIELDS: dict[str, LoreMatch] = {
    "matchPersonaDescription": "persona",
    "matchCharacterDescription": "description",
    "matchCharacterPersonality": "personality",
    "matchCharacterDepthPrompt": "depth_prompt",
    "matchScenario": "scenario",
    "matchCreatorNotes": "creator_notes",
}
_KNOWN_DECORATORS = ("@@activate", "@@dont_activate")
MAX_GROUPS = 16
MAX_GROUP_CHARS = 100


@dataclass
class EntryStats:
    """导入时顺带数的几样，进导入报告。每条最多各算一次。"""

    vectorized: int = 0
    character_filter: int = 0
    bad_regex: int = 0
    other_macros: int = 0


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.replace("\r\n", "\n").replace("\x00", "")
    if isinstance(value, int | float) and not isinstance(value, bool):
        return str(value)
    return ""


def _int(value: Any, default: int, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return default
    if value != value:  # NaN
        return default
    return max(lo, min(hi, int(value)))


def _opt_bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _keys(value: Any) -> tuple[str, ...]:
    """关键词：去掉首尾空白、空的、重复的、太长的；最多 MAX_KEYS 个。
    少数导出工具写成逗号分开的一串。"""
    items = value.split(",") if isinstance(value, str) else value
    if not isinstance(items, list):
        return ()
    result: list[str] = []
    for item in items:
        key = text(item).strip()
        if key and key not in result and len(key) <= MAX_KEY_CHARS:
            result.append(key)
        if len(result) >= MAX_KEYS:
            break
    return tuple(result)


def _turns(messages: Any) -> int:
    """ST 按消息条数算的粘滞、冷却、延迟 → 回合（一回合两条消息，向上取整）。"""
    n = _int(messages, 0, 0, 2000)
    return (n + 1) // 2


def _decorators(content: str) -> tuple[set[str], str]:
    """内容开头以 @@ 起头的几行是装饰（ST 的 parseDecorators）：认得的记下来，这几行都去掉。
    @@@ 开头的是“备选”：只有紧跟在一个不认得的装饰后面才算数。"""
    lines = content.split("\n")
    found: set[str] = set()
    fallback = False
    index = 0
    while index < len(lines) and lines[index].startswith("@@"):
        line = lines[index]
        index += 1
        if line.startswith("@@@") and not fallback:
            continue
        name = line[1:] if line.startswith("@@@") else line
        known = next((d for d in _KNOWN_DECORATORS if name.startswith(d)), None)
        if known is not None:
            found.add(known)
        fallback = known is None
    return found, "\n".join(lines[index:])


def _regex_ok(key: str) -> bool:
    parsed = regex_key(key)
    if parsed is None:
        return True
    flags = (
        (regex.IGNORECASE if parsed.ignore_case else 0)
        | (regex.DOTALL if parsed.dotall else 0)
        | (regex.MULTILINE if parsed.multiline else 0)
    )
    try:
        regex.compile(parsed.pattern, flags)
    except (regex.error, ValueError, OverflowError, RecursionError):
        return False
    return True


def _groups(value: Any) -> tuple[str, ...]:
    result: list[str] = []
    for part in text(value).split(","):
        group = part.strip()[:MAX_GROUP_CHARS]
        if group and group not in result:
            result.append(group)
    return tuple(result[:MAX_GROUPS])


def from_world(item: Mapping[str, Any], *, index: int, stats: EntryStats) -> LoreEntry | None:
    """ST 世界书文件里的一条；没有正文的返回 None。index 是它在文件里的位置。"""
    decorators, content = _decorators(text(item.get("content")))
    content = content.strip()[:MAX_FIELD_CHARS]
    if not content:
        return None
    keys = _keys(item.get("key"))
    selective = item.get("selective", True) is not False
    secondary = _keys(item.get("keysecondary")) if selective else ()
    logic = _LOGIC.get(_int(item.get("selectiveLogic"), 0, 0, 3), "any")
    use_probability = item.get("useProbability", True) is not False
    delay_rec = item.get("delayUntilRecursion")
    match: tuple[LoreMatch, ...] = tuple(m for f, m in _MATCH_FIELDS.items() if item.get(f) is True)
    triggers = item.get("triggers")
    rules = LoreRules(
        whole_words=_opt_bool(item.get("matchWholeWords")),
        case_sensitive=_opt_bool(item.get("caseSensitive")),
        scan_depth=None if item.get("scanDepth") is None else _int(item["scanDepth"], 0, 0, 1000),
        match=match,
        exclude_recursion=item.get("excludeRecursion") is True,
        prevent_recursion=item.get("preventRecursion") is True,
        delay_until_recursion=1 if delay_rec is True else _int(delay_rec, 0, 0, 100),
        probability=_int(item.get("probability"), 100, 0, 100) if use_probability else 100,
        groups=_groups(item.get("group")),
        group_override=item.get("groupOverride") is True,
        group_weight=_int(item.get("groupWeight"), 100, 0, 1_000_000),
        group_scoring=_opt_bool(item.get("useGroupScoring")),
        sticky=_turns(item.get("sticky")),
        cooldown=_turns(item.get("cooldown")),
        delay=_turns(item.get("delay")),
        triggers=tuple(t for t in LORE_TRIGGERS if isinstance(triggers, list) and t in triggers),
        ignore_budget=item.get("ignoreBudget") is True,
    )
    if item.get("vectorized") is True:
        stats.vectorized += 1
    character_filter = item.get("characterFilter")
    if isinstance(character_filter, Mapping) and (
        character_filter.get("names") or character_filter.get("tags")
    ):
        stats.character_filter += 1
    if not all(_regex_ok(k) for k in (*keys, *secondary)):
        stats.bad_regex += 1
    if has_other_macros(content) or any(has_other_macros(k) for k in (*keys, *secondary)):
        stats.other_macros += 1
    return LoreEntry(
        name=text(item.get("comment")).strip()[:MAX_ENTRY_NAME_CHARS],
        keys=keys,
        content=content,
        constant=item.get("constant") is True or "@@activate" in decorators,
        enabled=item.get("disable") is not True and "@@dont_activate" not in decorators,
        order=_int(item.get("displayIndex"), index, -MAX_PRIORITY, MAX_PRIORITY),
        secondary_keys=secondary,
        logic=logic,
        priority=_int(item.get("order"), DEFAULT_PRIORITY, -MAX_PRIORITY, MAX_PRIORITY),
        rules=None if rules == LoreRules() else rules,
    )


def from_book(item: Mapping[str, Any], *, index: int, stats: EntryStats) -> LoreEntry | None:
    """character_book 里的一条（卡里内嵌的、lorebook_v3 的）。"""
    ext = item.get("extensions")
    ext = ext if isinstance(ext, Mapping) else {}
    world: dict[str, Any] = {
        "key": item.get("keys"),
        "keysecondary": item.get("secondary_keys"),
        # 以前的导入取 name，没有再取 comment；ST 只认 comment
        "comment": item.get("name") or item.get("comment"),
        "content": item.get("content"),
        "constant": item.get("constant"),
        # ST 这里是 selective || false：没写就不看次要关键词（世界书文件里默认是看的）
        "selective": item.get("selective") is True,
        "order": item.get("insertion_order"),
        "disable": item.get("enabled", True) is False,
        "displayIndex": ext.get("display_index"),
        "probability": ext.get("probability"),
        "useProbability": ext.get("useProbability", True),
        "selectiveLogic": ext.get("selectiveLogic"),
        "group": ext.get("group"),
        "groupOverride": ext.get("group_override"),
        "groupWeight": ext.get("group_weight"),
        "excludeRecursion": ext.get("exclude_recursion"),
        "preventRecursion": ext.get("prevent_recursion"),
        "delayUntilRecursion": ext.get("delay_until_recursion"),
        "scanDepth": ext.get("scan_depth"),
        "caseSensitive": ext.get("case_sensitive", item.get("case_sensitive")),
        "matchWholeWords": ext.get("match_whole_words"),
        "useGroupScoring": ext.get("use_group_scoring"),
        "vectorized": ext.get("vectorized"),
        "sticky": ext.get("sticky"),
        "cooldown": ext.get("cooldown"),
        "delay": ext.get("delay"),
        "matchPersonaDescription": ext.get("match_persona_description"),
        "matchCharacterDescription": ext.get("match_character_description"),
        "matchCharacterPersonality": ext.get("match_character_personality"),
        "matchCharacterDepthPrompt": ext.get("match_character_depth_prompt"),
        "matchScenario": ext.get("match_scenario"),
        "matchCreatorNotes": ext.get("match_creator_notes"),
        "triggers": ext.get("triggers"),
        "ignoreBudget": ext.get("ignore_budget"),
    }
    return from_world(world, index=index, stats=stats)


def is_book_entry(item: Mapping[str, Any]) -> bool:
    """character_book 的条目用 keys、insertion_order；世界书文件用 key、order、disable。"""
    return "keys" in item and "key" not in item
