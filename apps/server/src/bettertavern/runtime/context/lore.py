"""每回合挑世界书条目（docs/lorebook.md 第 7 节）：照 SillyTavern 新装默认设置的规则
（public/scripts/world-info.js 的 checkWorldInfo），快照是 domain/world/lore.py 的 LoreSnapshot。

- 扫哪些文字：最近 2 条消息（玩家这次的行动、上一段叙述），前面带说话人的名字
  （ST 的 world_info_include_names），所以关键词是角色名、主角名的条目几乎每回合都会触发；
- 怎么算命中：不区分大小写，整词匹配（关键词前后不能紧挨英文字母、数字、下划线；关键词里有空格时
  按包含找；中文实际就是按包含找），多做一步全角转半角；/……/flags 写的是正则，按原文匹配；
- 一轮里：主关键词命中任一个，再按次要关键词的逻辑判断；常驻的不看关键词；
- 预算：有效窗口的 25%，最多 12000 token（ST 不封顶）。整局不变的常驻条目先占（它们放在系统提示
  里），其余的按优先级（priority 大的先）装，装不下就停；
- 递归：这一轮装进去的条目（prevent_recursion 的除外）的正文加进要扫的文字，再扫一轮，直到没有
  新条目或者预算满了；exclude_recursion 的条目只在第一轮能进；delay_until_recursion 的只在递归的
  轮次里能进（第一层一开始就算轮到；没有新条目时，还有更高的层级没轮到就按下一层多扫一轮，同 ST）；
- 放进上下文的顺序：priority 从小到大（大的靠后，离生成点近）。

同样的快照和文字永远挑出同样的条目：没有随机、不记状态。正则用 regex 库，每个最多
REGEX_TIMEOUT_S 秒，一回合加起来最多 REGEX_TURN_BUDGET_S 秒，超时的当没命中；
调用方把整个挑选放在线程里跑。
"""

from __future__ import annotations

import math
import re
import time
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import regex

from bettertavern.domain.scenario.card import LoreEntry, LoreRules
from bettertavern.domain.scenario.lorebook import regex_key
from bettertavern.domain.world.lore import LoreItem, LoreSnapshot
from bettertavern.runtime.ports import TurnContext

from .tokens import estimate_tokens

LORE_RATIO = 0.25
LORE_CAP = 12_000
DEFAULT_DEPTH = 2  # ST 的 world_info_depth
REGEX_TIMEOUT_S = 0.02
REGEX_TURN_BUDGET_S = 0.2
_DEFAULT_RULES = LoreRules()
_WORD = r"[A-Za-z0-9_]"  # JS 不带 u 时 \w 的范围


def lore_budget(window: int) -> int:
    return min(math.floor(window * LORE_RATIO), LORE_CAP)


@dataclass(frozen=True)
class LoreScan:
    """要扫的文字：最近的消息，从新到旧，每条前面带说话人的名字。"""

    messages: tuple[str, ...]


@dataclass(frozen=True)
class LoreSelection:
    constants: tuple[LoreItem, ...]  # 放进系统提示的常驻条目，priority 从小到大
    triggered: tuple[LoreItem, ...]  # 放进最后一条消息的，priority 从小到大
    stats: dict[str, Any] = field(default_factory=dict)  # 记进导演那次运行的 result.lore


def _said(name: str, text: str) -> str:
    return f"{name}: {text}" if name else text


def scan_of(ctx: TurnContext) -> LoreScan:
    """这一回合要扫的消息，从新到旧：玩家这次的行动、上一段叙述、再往前的行动和叙述……
    （上下文里有的原文回合）。开场那一回合扫开场简报。名字取快照里存的主角名、主角色名。"""
    snapshot = ctx.lore
    user = (snapshot.user_name if snapshot else "") or ctx.protagonist_name
    char = snapshot.char_name if snapshot else ""
    if ctx.action.source == "opening":
        opening = ctx.seed.opening if ctx.seed is not None else None
        parts = [ctx.opening_greeting]
        if opening is not None:
            parts += [opening.location or "", " ".join(opening.present), opening.situation]
            parts.append(opening.hook)
        return LoreScan(messages=(_said(char, "\n".join(p for p in parts if p)),))
    messages = [_said(user, ctx.action.text)]
    for turn in reversed(ctx.history):
        messages.append(_said(char, turn.narrative))
        if turn.action.source != "opening":
            messages.append(_said(user, turn.action.text))
    return LoreScan(messages=tuple(messages))


def _rules(entry: LoreEntry) -> LoreRules:
    return entry.rules if entry.rules is not None else _DEFAULT_RULES


def _cost(item: LoreItem) -> int:
    return estimate_tokens(item.entry.content)


def _by_priority(snapshot: LoreSnapshot) -> list[int]:
    """优先级从高到低的条目序号：priority 大的在前，一样大的按快照里的先后。"""
    items = snapshot.items
    return sorted(range(len(items)), key=lambda i: (-items[i].entry.effective_priority(), i))


def _in_context_order(snapshot: LoreSnapshot, indices: Sequence[int]) -> tuple[LoreItem, ...]:
    items = snapshot.items
    ordered = sorted(indices, key=lambda i: (items[i].entry.effective_priority(), i))
    return tuple(items[i] for i in ordered)


def _is_static(entry: LoreEntry) -> bool:
    """整局都不变的常驻条目：放进系统提示，前缀缓存一直有效。"""
    return entry.constant


def static_constants(snapshot: LoreSnapshot | None, window: int) -> tuple[list[int], int]:
    """放进系统提示的常驻条目（序号，按优先级从高到低）和它们占的 token。
    只看快照和窗口，所以整局不变（换了模型、窗口变了才可能变）。"""
    if snapshot is None:
        return [], 0
    budget = lore_budget(window)
    picked: list[int] = []
    used = 0
    for index in _by_priority(snapshot):
        entry = snapshot.items[index].entry
        if not _is_static(entry):
            continue
        cost = _cost(snapshot.items[index])
        if used + cost >= budget and not _rules(entry).ignore_budget:
            break  # 同 ST：装不下的那一条不要，之后的也不要了
        picked.append(index)
        used += cost
    return picked, used


def constant_items(snapshot: LoreSnapshot | None, window: int) -> tuple[LoreItem, ...]:
    if snapshot is None:
        return ()
    picked, _ = static_constants(snapshot, window)
    return _in_context_order(snapshot, picked)


# ---- 匹配 ---------------------------------------------------------------------------------


def _fold(text: str, *, case_sensitive: bool) -> str:
    text = unicodedata.normalize("NFKC", text)
    return text if case_sensitive else text.casefold()


@lru_cache(maxsize=4096)
def _word_pattern(key: str) -> re.Pattern[str]:
    # 关键词是转义过的字面量，不会回溯爆炸
    return re.compile(rf"(?<!{_WORD}){re.escape(key)}(?!{_WORD})")


@lru_cache(maxsize=4096)
def _compiled(pattern: str, flags: int) -> regex.Pattern[str] | None:
    try:
        return regex.compile(pattern, flags)
    except (regex.error, ValueError, OverflowError, RecursionError):
        return None


class _Matcher:
    """一回合用一个：缓存折叠过的文字，记正则用了多久。"""

    def __init__(self, clock: Callable[[], float]) -> None:
        self._clock = clock
        self._folded: dict[tuple[str, bool], str] = {}
        self.regex_spent = 0.0
        self.regex_timeouts = 0

    def _haystack(self, text: str, case_sensitive: bool) -> str:
        key = (text, case_sensitive)
        if key not in self._folded:
            self._folded[key] = _fold(text, case_sensitive=case_sensitive)
        return self._folded[key]

    def matches(self, key: str, text: str, rules: LoreRules) -> bool:
        parsed = regex_key(key)
        if parsed is not None:
            return self._regex(parsed.pattern, parsed, text)
        case_sensitive = bool(rules.case_sensitive)
        needle = _fold(key, case_sensitive=case_sensitive)
        haystack = self._haystack(text, case_sensitive)
        whole_words = rules.whole_words if rules.whole_words is not None else True
        if not whole_words or len(needle.split()) > 1:
            return needle in haystack
        return needle in haystack and _word_pattern(needle).search(haystack) is not None

    def _regex(self, pattern: str, parsed: Any, text: str) -> bool:
        if self.regex_spent >= REGEX_TURN_BUDGET_S:
            self.regex_timeouts += 1
            return False
        flags = (
            (regex.IGNORECASE if parsed.ignore_case else 0)
            | (regex.DOTALL if parsed.dotall else 0)
            | (regex.MULTILINE if parsed.multiline else 0)
        )
        compiled = _compiled(pattern, flags)
        if compiled is None:
            return False
        started = self._clock()
        try:
            return compiled.search(text, timeout=REGEX_TIMEOUT_S, concurrent=True) is not None
        except TimeoutError:
            self.regex_timeouts += 1
            return False
        finally:
            self.regex_spent += self._clock() - started


def _secondary_ok(entry: LoreEntry, text: str, rules: LoreRules, matcher: _Matcher) -> bool:
    if not entry.secondary_keys:
        return True
    hits = [matcher.matches(k, text, rules) for k in entry.secondary_keys]
    if entry.logic == "any":
        return any(hits)
    if entry.logic == "all":
        return all(hits)
    if entry.logic == "not_any":
        return not any(hits)
    return not all(hits)  # not_all


# ---- 挑选 ---------------------------------------------------------------------------------


def select_lore(
    snapshot: LoreSnapshot | None,
    scan: LoreScan,
    *,
    window: int,
    clock: Callable[[], float] = time.monotonic,
) -> LoreSelection:
    if snapshot is None or not snapshot.items:
        return LoreSelection(constants=(), triggered=())
    items = snapshot.items
    budget = lore_budget(window)
    constants, used = static_constants(snapshot, window)
    in_system = set(constants)
    order = _by_priority(snapshot)
    matcher = _Matcher(clock)
    base = "\n".join(scan.messages[:DEFAULT_DEPTH])
    activated: list[int] = []
    taken: set[int] = set()
    recursed: list[str] = []
    from_recursion = 0
    overflowed = False
    dropped = 0
    levels = sorted({_rules(i.entry).delay_until_recursion for i in items} - {0})
    level = levels.pop(0) if levels else 0
    recursion = False
    while True:
        text = base if not recursion else "\n".join([base, *recursed])
        found: list[int] = []
        for index in order:
            if index in taken or index in in_system:
                continue
            entry = items[index].entry
            rules = _rules(entry)
            if rules.delay_until_recursion and (
                not recursion or rules.delay_until_recursion > level
            ):
                continue
            if recursion and rules.exclude_recursion:
                continue
            if entry.constant:
                found.append(index)
                continue
            if not entry.keys:
                continue
            if not any(matcher.matches(k, text, rules) for k in entry.keys):
                continue
            if _secondary_ok(entry, text, rules, matcher):
                found.append(index)
        added: list[int] = []
        for index in found:
            rules = _rules(items[index].entry)
            if overflowed and not rules.ignore_budget:
                break
            taken.add(index)
            cost = _cost(items[index])
            if not rules.ignore_budget and used + cost >= budget:
                overflowed = True  # 同 ST：装不下的这一条不要，之后的也停
                dropped += 1
                continue
            used += cost
            added.append(index)
            activated.append(index)
            if recursion:
                from_recursion += 1
        dropped += sum(1 for i in found if i not in taken)
        spread = [i for i in added if not _rules(items[i].entry).prevent_recursion]
        if not overflowed and spread:
            recursion = True
            recursed.extend(items[i].entry.content for i in spread)
            continue
        if levels and not overflowed:
            # 没有新条目了，但还有“只在递归时触发”的层级没轮到：为它们多扫一轮
            level = levels.pop(0)
            recursion = True
            continue
        break
    stats: dict[str, Any] = {
        "constant": len(constants),
        "triggered": sorted(activated),
        "recursion": from_recursion,
        "dropped": dropped,
    }
    if matcher.regex_timeouts:
        stats["regex_timeouts"] = matcher.regex_timeouts
    return LoreSelection(
        constants=_in_context_order(snapshot, constants),
        triggered=_in_context_order(snapshot, activated),
        stats=stats,
    )
