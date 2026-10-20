"""世界状态的一致性规则（backend.md 第 3 节“提交时的一致性校验”）。

世界状态 agent 的每个修改操作在执行时就按这些规则检查（draft.py）；提交前再对整个世界检查一遍，
只看这次新出现的问题，开局时就有的不算。100 回合回放的评测也用它逐回合检查。
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .plan import REL_HELD_BY, REL_LOCATED_IN
from .records import WorldRecords


@dataclass(frozen=True, slots=True)
class Issue:
    code: str  # 问题的种类；给模型看的说明按代码取（runtime/prompts/<lang>/state_keeper.json）
    params: Mapping[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> tuple[str, tuple[tuple[str, str], ...]]:
        return (self.code, tuple(sorted((k, str(v)) for k, v in self.params.items())))


def check_world(world: WorldRecords) -> list[Issue]:
    """整个世界里违反规则的地方，按固定顺序排列（同样的输入结果相同）。"""
    issues: list[Issue] = []
    by_id = {e.id: e for e in world.entities}
    heroes = [e for e in world.entities if e.is_protagonist and not e.retired]
    if len(heroes) != 1:
        issues.append(Issue("protagonist_count", {"count": len(heroes)}))

    places: Counter[str] = Counter()
    for link in world.links:
        if link.rel in (REL_LOCATED_IN, REL_HELD_BY):
            places[link.src_id] += 1
    for entity_id, count in sorted(places.items()):
        entity = by_id.get(entity_id)
        if entity is not None and count > 1:
            issues.append(Issue("two_places", {"name": entity.name}))

    scene_holder = next((e for e in world.entities if e.kind == "world"), None)
    scene = (scene_holder.data.get("scene") or {}) if scene_holder is not None else {}
    for present_id in scene.get("present") or ():
        entity = by_id.get(str(present_id))
        if entity is None or entity.retired:
            name = entity.name if entity is not None else str(present_id)
            issues.append(Issue("present_retired", {"name": name}))
    location_id = scene.get("location")
    if location_id:
        location = by_id.get(str(location_id))
        if location is None or location.retired or location.kind != "location":
            issues.append(Issue("scene_location", {"name": location.name if location else ""}))
    return issues


def new_issues(before: WorldRecords, after: WorldRecords) -> list[Issue]:
    """after 里有、before 里没有的问题。"""
    old = {i.key for i in check_world(before)}
    return [i for i in check_world(after) if i.key not in old]
