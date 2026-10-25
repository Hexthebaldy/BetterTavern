"""世界书里要“记状态”或“随机”的几条规则（docs/lorebook.md 第 7.3 节），是 lore.py 的同级文件。
规则照 SillyTavern（public/scripts/world-info.js 的 WorldInfoTimedEffects、
filterByInclusionGroups）：

- 粘滞（sticky）、冷却（cooldown）：ST 记在聊天的元数据里、按消息条数算；我们按回合算，
  记在每个回合的 turns.lore 里，下一回合读上一回合（活跃链上的父回合）的。回退以后读的是目标回合的
  记录，自然跟着回去。规则：触发时开始粘滞（还在粘滞期的不重新开始），粘滞期内一直算触发；
  粘滞结束、或者没设粘滞的触发之后开始冷却，冷却期内不能触发；
- 随机（概率、同组按权重抽）：约定是上下文里不能用随机函数（重放测试靠它），所以用存档、回合号、
  时间线编号算哈希当随机数：同一回合重试结果一样，回退以后重写这一回合会重新抽；
- 同组只留一条：组里有在粘滞期的就只留粘滞的；开了组打分的先留命中关键词最多的；这一组已经有条目
  进来了就全不要；有组内优先的取优先级最大的；剩下的按权重抽一条。
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from bettertavern.domain.scenario.card import LoreRules
from bettertavern.domain.world.lore import LoreItem

_DEFAULT_RULES = LoreRules()


def rules_of(item: LoreItem) -> LoreRules:
    return item.entry.rules if item.entry.rules is not None else _DEFAULT_RULES


def roll(seed: str, key: str) -> float:
    """[0, 1) 之间、由 seed 和 key 决定的“随机数”。"""
    digest = hashlib.sha256(f"{seed}|{key}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def passes_probability(item: LoreItem, index: int, seed: str) -> bool:
    probability = rules_of(item).probability
    if probability >= 100:
        return True
    return roll(seed, f"prob:{index}") * 100 <= probability


@dataclass(frozen=True)
class LoreTimers:
    """粘滞、冷却：条目在快照里的序号 → 到第几回合为止（含这一回合）。"""

    sticky: Mapping[int, int] = field(default_factory=dict)
    cooldown: Mapping[int, int] = field(default_factory=dict)

    @classmethod
    def from_json(cls, data: Mapping[str, Any] | None) -> LoreTimers:
        """turns.lore 里的 sticky、cooldown（JSON 的键是字符串）；没有、或者坏了的当空的。"""

        def table(value: Any) -> dict[int, int]:
            if not isinstance(value, Mapping):
                return {}
            out: dict[int, int] = {}
            for key, end in value.items():
                if str(key).isdigit() and isinstance(end, int) and not isinstance(end, bool):
                    out[int(key)] = end
            return out

        data = data or {}
        return cls(sticky=table(data.get("sticky")), cooldown=table(data.get("cooldown")))

    def sticky_at(self, turn: int) -> set[int]:
        return {i for i, end in self.sticky.items() if end >= turn}

    def cooldown_at(self, turn: int) -> set[int]:
        return {i for i, end in self.cooldown.items() if end >= turn}

    def after(self, turn: int, items: Sequence[LoreItem], activated: Iterable[int]) -> LoreTimers:
        """第 turn 回合挑完以后的状态（给下一回合用），只留之后还起作用的记录。
        activated 是这一回合新触发的（不算粘滞期里接着生效的）。"""
        sticky = dict(self.sticky)
        cooldown = {i: end for i, end in self.cooldown.items() if end >= turn}
        for index in activated:
            if index >= len(items):
                continue
            rules = rules_of(items[index])
            if rules.sticky and sticky.get(index, -1) < turn:
                sticky[index] = turn + rules.sticky
            if rules.cooldown and index not in cooldown:
                cooldown[index] = turn + rules.cooldown
        # 粘滞在这一回合（或更早）结束的：冷却从下一回合算起（同 ST：粘滞结束时重新开始冷却）
        for index, end in list(sticky.items()):
            if end > turn:
                continue
            del sticky[index]
            length = rules_of(items[index]).cooldown if index < len(items) else 0
            if length and end + length > turn:
                cooldown[index] = end + length
        return LoreTimers(
            sticky=sticky, cooldown={i: end for i, end in cooldown.items() if end > turn}
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "sticky": {str(i): end for i, end in sorted(self.sticky.items())},
            "cooldown": {str(i): end for i, end in sorted(self.cooldown.items())},
        }


def filter_groups(
    found: Sequence[int],
    items: Sequence[LoreItem],
    *,
    activated: Iterable[int],
    sticky: set[int],
    score: Callable[[int], int],
    seed: str,
    round_no: int,
) -> list[int]:
    """同一轮里同组的只留一条（found 是这一轮命中的序号，按粘滞的在前、优先级从高到低排好）。"""
    groups: dict[str, list[int]] = {}
    for index in found:
        for name in rules_of(items[index]).groups:
            groups.setdefault(name, []).append(index)
    if not groups:
        return list(found)
    taken_groups = {name for i in activated for name in rules_of(items[i]).groups}
    removed: set[int] = set()
    for name, all_members in groups.items():
        members = [m for m in all_members if m not in removed]
        stuck = [m for m in members if m in sticky]
        if stuck:
            removed.update(m for m in members if m not in stuck)
            continue
        if any(rules_of(items[m]).group_scoring for m in members):
            scores = {m: score(m) for m in members}
            top = max(scores.values())
            for m in members:
                if rules_of(items[m]).group_scoring and scores[m] < top:
                    removed.add(m)
            members = [m for m in members if m not in removed]
        if name in taken_groups:
            removed.update(members)
            continue
        if len(members) <= 1:
            continue
        favored = [m for m in members if rules_of(items[m]).group_override]
        if favored:
            best = min(favored, key=lambda m: (-items[m].entry.effective_priority(), m))
            removed.update(m for m in members if m != best)
            continue
        total = sum(rules_of(items[m]).group_weight for m in members)
        target = roll(seed, f"group:{name}:{round_no}") * total
        running = 0
        winner = members[0]
        for m in members:
            running += rules_of(items[m]).group_weight
            if target <= running:
                winner = m
                break
        removed.update(m for m in members if m != winner)
    return [i for i in found if i not in removed]
