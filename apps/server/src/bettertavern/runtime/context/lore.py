"""每回合挑世界书条目（docs/lorebook.md 第 7 节）：照 SillyTavern 新装默认设置的规则
（public/scripts/world-info.js 的 checkWorldInfo），快照是 domain/world/lore.py 的 LoreSnapshot。
关键词怎么算命中在 lore_match.py，粘滞冷却、随机和分组在 lore_effects.py。

- 扫哪些文字：最近 2 条消息（玩家这次的行动、上一段叙述；条目可以自己改扫几条），前面带说话人的
  名字（ST 的 world_info_include_names），所以关键词是角色名、主角名的条目几乎每回合都会触发；
  勾了“顺带扫描”的条目还扫主角介绍、卡的描述等；
- 一轮里：停用的、只在别的生成方式下触发的、还在冷却或延迟期的跳过；常驻的、粘滞期里的直接算；
  其余的主关键词命中任一个，再按次要关键词的逻辑判断；然后同组只留一条，按优先级掷概率、装预算；
- 预算：有效窗口的 25%，最多 12000 token（ST 不封顶）。整局不变的常驻条目先占（它们放在系统提示
  里），其余的按优先级（priority 大的先）装，装不下就停；
- 递归：这一轮装进去的条目（prevent_recursion 的除外）的正文加进要扫的文字，再扫一轮，直到没有
  新条目或者预算满了；exclude_recursion 的条目只在第一轮能进；delay_until_recursion 的只在递归的
  轮次里能进（第一层一开始就算轮到；没有新条目时，还有更高的层级没轮到就按下一层多扫一轮，同 ST）；
- 放进上下文的顺序：priority 从小到大（大的靠后，离生成点近）。

同样的快照、文字、回合和上一回合的记录永远挑出同样的条目。调用方把整个挑选放在线程里跑。
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from bettertavern.domain.world.lore import LoreItem, LoreSnapshot
from bettertavern.runtime.ports import TurnContext

from .lore_effects import LoreTimers, filter_groups, passes_probability, rules_of
from .lore_match import Matcher
from .tokens import estimate_tokens

LORE_RATIO = 0.25
LORE_CAP = 12_000
DEFAULT_DEPTH = 2  # ST 的 world_info_depth
TRIGGER = "normal"  # 我们每一回合都相当于 ST 的“普通生成”


def lore_budget(window: int) -> int:
    return min(math.floor(window * LORE_RATIO), LORE_CAP)


@dataclass(frozen=True)
class LoreScan:
    """这一回合要扫的：最近的消息（从新到旧，每条前面带说话人的名字），第几回合，
    算“随机”用的种子，上一回合留下的粘滞、冷却记录。"""

    messages: tuple[str, ...]
    turn: int = 0
    seed: str = ""
    timers: LoreTimers = field(default_factory=LoreTimers)


@dataclass(frozen=True)
class LoreSelection:
    constants: tuple[LoreItem, ...]  # 放进系统提示的常驻条目，priority 从小到大
    triggered: tuple[LoreItem, ...]  # 放进最后一条消息的，priority 从小到大
    stats: dict[str, Any] = field(default_factory=dict)  # 记进导演那次运行的 result.lore
    record: dict[str, Any] = field(default_factory=dict)  # 记进这一回合的 turns.lore


def _said(name: str, text: str) -> str:
    return f"{name}: {text}" if name else text


def scan_of(ctx: TurnContext) -> LoreScan:
    """这一回合要扫的消息，从新到旧：玩家这次的行动、上一段叙述、再往前的行动和叙述……
    （上下文里有的原文回合）。开场那一回合扫开场简报。名字取快照里存的主角名、主角色名。"""
    snapshot = ctx.lore
    header = ctx.header
    user = (snapshot.user_name if snapshot else "") or ctx.protagonist_name
    char = snapshot.char_name if snapshot else ""
    seed = f"{header.playthrough_id}:{header.seq}:{header.epoch}"
    timers = LoreTimers.from_json(ctx.lore_record)
    if ctx.action.source == "opening":
        opening = ctx.seed.opening if ctx.seed is not None else None
        parts = [ctx.opening_greeting]
        if opening is not None:
            parts += [opening.location or "", " ".join(opening.present), opening.situation]
            parts.append(opening.hook)
        text = _said(char, "\n".join(p for p in parts if p))
        return LoreScan(messages=(text,), turn=header.seq, seed=seed, timers=timers)
    messages = [_said(user, ctx.action.text)]
    for turn in reversed(ctx.history):
        messages.append(_said(char, turn.narrative))
        if turn.action.source != "opening":
            messages.append(_said(user, turn.action.text))
    return LoreScan(messages=tuple(messages), turn=header.seq, seed=seed, timers=timers)


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


def _blocked_trigger(item: LoreItem) -> bool:
    triggers = rules_of(item).triggers
    return bool(triggers) and TRIGGER not in triggers


def _is_static(item: LoreItem) -> bool:
    """整局都不变的常驻条目：放进系统提示，前缀缓存一直有效。分了组、设了概率、粘滞冷却延迟、
    只在递归时触发的常驻条目每回合可能不一样，和其余条目一起在最后一条消息里。"""
    entry, rules = item.entry, rules_of(item)
    return (
        entry.constant
        and not rules.groups
        and rules.probability >= 100
        and not (rules.sticky or rules.cooldown or rules.delay)
        and not rules.delay_until_recursion
        and not _blocked_trigger(item)
    )


def static_constants(snapshot: LoreSnapshot | None, window: int) -> tuple[list[int], int]:
    """放进系统提示的常驻条目（序号，按优先级从高到低）和它们占的 token。
    只看快照和窗口，所以整局不变（换了模型、窗口变了才可能变）。"""
    if snapshot is None:
        return [], 0
    budget = lore_budget(window)
    picked: list[int] = []
    used = 0
    for index in _by_priority(snapshot):
        item = snapshot.items[index]
        if not _is_static(item):
            continue
        cost = _cost(item)
        if used + cost >= budget and not rules_of(item).ignore_budget:
            break  # 同 ST：装不下的那一条不要，之后的也不要了
        picked.append(index)
        used += cost
    return picked, used


def constant_items(snapshot: LoreSnapshot | None, window: int) -> tuple[LoreItem, ...]:
    if snapshot is None:
        return ()
    picked, _ = static_constants(snapshot, window)
    return _in_context_order(snapshot, picked)


class _Texts:
    """每条条目要扫的文字：按它自己的扫描深度取最近几条消息，加上顺带扫描的几段，递归时再加上
    这一回合已经装进去的条目正文。同样的组合只拼一次。"""

    def __init__(self, snapshot: LoreSnapshot, scan: LoreScan) -> None:
        self._snapshot = snapshot
        self._messages = scan.messages
        self._cache: dict[tuple[Any, ...], str] = {}
        self.recursed: list[str] = []

    def of(self, item: LoreItem, *, recursion: bool) -> str:
        rules = rules_of(item)
        depth = rules.scan_depth if rules.scan_depth is not None else DEFAULT_DEPTH
        if depth <= 0:
            return ""  # 同 ST：扫描深度 0 时什么都不扫
        key = (depth, rules.match, item.card, len(self.recursed) if recursion else -1)
        if key not in self._cache:
            parts = list(self._messages[:depth])
            for which in rules.match:
                if which == "persona":
                    parts.append(self._snapshot.persona)
                elif item.card < len(self._snapshot.cards):
                    parts.append(self._snapshot.cards[item.card].text(which))
            if recursion:
                parts += self.recursed
            self._cache[key] = "\n".join(p for p in parts if p)
        return self._cache[key]


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
    rank = {index: position for position, index in enumerate(order)}
    matcher = Matcher(clock)
    texts = _Texts(snapshot, scan)
    sticky = scan.timers.sticky_at(scan.turn)
    cooling = scan.timers.cooldown_at(scan.turn)
    activated: list[int] = []
    done: set[int] = set(in_system)
    failed_probability: set[int] = set()
    new: list[int] = []  # 这一回合新触发的（不算粘滞期里接着生效的），开始计时用
    from_recursion = dropped = 0
    overflowed = False
    levels = sorted({rules_of(i).delay_until_recursion for i in items} - {0})
    level = levels.pop(0) if levels else 0
    recursion = False
    round_no = 0
    while True:
        found: list[int] = []
        for index in order:
            if index in done or index in failed_probability:
                continue
            item = items[index]
            entry, rules = item.entry, rules_of(item)
            if _blocked_trigger(item):
                continue
            if rules.delay and scan.turn < rules.delay:
                continue  # 同 ST：延迟期里粘滞的也不进
            if index in cooling and index not in sticky:
                continue
            if (
                rules.delay_until_recursion
                and index not in sticky
                and (not recursion or rules.delay_until_recursion > level)
            ):
                continue
            if recursion and rules.exclude_recursion and index not in sticky:
                continue
            if entry.constant or index in sticky:
                found.append(index)
                continue
            if not entry.keys:
                continue
            text = texts.of(item, recursion=recursion)
            if not any(matcher.matches(k, text, rules) for k in entry.keys):
                continue
            if matcher.secondary_ok(entry, text, rules):
                found.append(index)
        # 粘滞期里的排在前面，其余按优先级
        found.sort(key=lambda i: (i not in sticky, rank[i]))

        def score(index: int, in_recursion: bool = recursion) -> int:
            item = items[index]
            return matcher.score(item.entry, texts.of(item, recursion=in_recursion), rules_of(item))

        found = filter_groups(
            found,
            items,
            activated=activated,
            sticky=sticky,
            score=score,
            seed=scan.seed,
            round_no=round_no,
        )
        added: list[int] = []
        for position, index in enumerate(found):
            item = items[index]
            rules = rules_of(item)
            if overflowed and not rules.ignore_budget:
                dropped += sum(1 for i in found[position:] if not rules_of(items[i]).ignore_budget)
                break
            if index not in sticky and not passes_probability(item, index, scan.seed):
                failed_probability.add(index)
                continue
            cost = _cost(item)
            if not rules.ignore_budget and used + cost >= budget:
                overflowed = True  # 同 ST：装不下的这一条不要，之后的也停
                dropped += 1
                continue
            used += cost
            done.add(index)
            added.append(index)
            activated.append(index)
            if index not in sticky:
                new.append(index)
            if recursion:
                from_recursion += 1
        round_no += 1
        spread = [i for i in added if not rules_of(items[i]).prevent_recursion]
        if not overflowed and spread:
            recursion = True
            texts.recursed.extend(items[i].entry.content for i in spread)
            continue
        if levels and not overflowed:
            # 没有新条目了，但还有更高的“只在递归时触发”的层级没轮到：按下一层多扫一轮
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
    if sticky & set(activated):
        stats["sticky"] = sorted(sticky & set(activated))
    if matcher.regex_timeouts:
        stats["regex_timeouts"] = matcher.regex_timeouts
    timers = scan.timers.after(scan.turn, items, new)
    return LoreSelection(
        constants=_in_context_order(snapshot, constants),
        triggered=_in_context_order(snapshot, activated),
        stats=stats,
        record={"hits": sorted(activated), **timers.to_json()},
    )
