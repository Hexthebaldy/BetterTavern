"""剧本试玩的检查点：剧本里写明“整理完第几回合以后，世界应该是什么样”，跑完逐条判断（纯函数）。

人和物按名字或别名找：名字里包含所写的字就算对上（模型起的名字不固定，例如“看守货栈的老人”）。
判断只看世界状态，不用模型；同样的世界每次结果相同。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.records import EntityRecord, WorldRecords

# 检查的种类 → 参数个数
CHECK_KINDS: Mapping[str, int] = {
    "retired": 1,  # 已退场
    "alive": 1,  # 还在（没退场）
    "holds": 2,  # [人, 物]：物在这个人手里
    "not_holds": 2,  # [人, 物]：物不在这个人手里
    "at": 2,  # [人或物, 地点]：在名字里带这些字的地方（物在谁手里就看那个人在哪）
    "not_at": 2,
    "together": 2,  # [甲, 乙]：在同一个地方
    "apart": 2,  # [甲, 乙]：不在同一个地方
    "present": 1,  # 在当前场景里
    "absent": 1,  # 不在当前场景里
    "gone": 1,  # 已退场，或者不在当前场景里
    "fact": -1,  # [字, 字, ...]：有一条有效的事实同时提到这些字
}


@dataclass(frozen=True)
class Check:
    after: int  # 整理完第几回合以后
    kind: str
    args: tuple[str, ...]


@dataclass(frozen=True)
class RecallProbe:
    """召回题：玩家早先说出的细节，后面再问；第 turn 回合的叙述里要出现 expect 里的每个词。"""

    turn: int
    expect: tuple[str, ...]


@dataclass(frozen=True)
class ProbeResult:
    probe: RecallProbe
    passed: bool
    tool_rounds: int  # 导演那一回合用了几轮召回工具
    detail: str  # 叙述里命中处附近的原文，或者“叙述里没有”

    def to_json(self) -> dict[str, Any]:
        return {
            "turn": self.probe.turn,
            "expect": list(self.probe.expect),
            "passed": self.passed,
            "tool_rounds": self.tool_rounds,
            "detail": self.detail,
        }


def parse_probes(raw: Sequence[Mapping[str, Any]] | None) -> list[RecallProbe]:
    return [
        RecallProbe(int(item["turn"]), tuple(str(w) for w in item["expect"])) for item in raw or ()
    ]


def evaluate_probes(
    probes: Sequence[RecallProbe],
    narratives: Mapping[int, str],
    tool_rounds: Mapping[int, int],
) -> list[ProbeResult]:
    results: list[ProbeResult] = []
    for probe in probes:
        text = narratives.get(probe.turn, "")
        missing = [w for w in probe.expect if w not in text]
        if missing:
            detail = "叙述里没有：" + "、".join(missing) if text else "这一回合没有叙述"
        else:
            at = text.index(probe.expect[0])
            detail = "……" + " ".join(text[max(0, at - 30) : at + 30].split()) + "……"
        results.append(ProbeResult(probe, not missing, tool_rounds.get(probe.turn, 0), detail))
    return results


@dataclass(frozen=True)
class CheckResult:
    check: Check
    passed: bool
    detail: str  # 实际记成了什么

    def to_json(self) -> dict[str, Any]:
        return {
            "after": self.check.after,
            "kind": self.check.kind,
            "args": list(self.check.args),
            "passed": self.passed,
            "detail": self.detail,
        }


def parse_checks(raw: Sequence[Mapping[str, Any]] | None) -> list[Check]:
    checks: list[Check] = []
    for block in raw or ():
        after = int(block["after"])
        for item in block.get("expect") or ():
            [(kind, value)] = dict(item).items()
            args = tuple(str(v) for v in value) if isinstance(value, list) else (str(value),)
            expected = CHECK_KINDS.get(kind)
            if expected is None:
                raise ValueError(f"unknown check kind: {kind}")
            if expected > 0 and len(args) != expected:
                raise ValueError(f"check {kind} takes {expected} argument(s), got {list(args)}")
            checks.append(Check(after, kind, args))
    return checks


class _World:
    """一回合整理完以后的世界，按名字找人和物、算位置。"""

    def __init__(self, world: WorldRecords) -> None:
        self.world = world
        self.by_id = {e.id: e for e in world.entities}
        self.places = {
            lk.src_id: (lk.rel, lk.dst_id)
            for lk in world.links
            if lk.rel in ("located_in", "held_by")
        }
        scene_holder = next((e for e in world.entities if e.kind == "world"), None)
        self.scene: Mapping[str, Any] = (
            dict(scene_holder.data.get("scene") or {}) if scene_holder is not None else {}
        )

    def find(self, text: str) -> list[EntityRecord]:
        key = normalize_name(text)
        return [
            e
            for e in self.world.entities
            if e.kind != "world"
            and key
            and any(key in normalize_name(n) for n in (e.name, *e.aliases))
        ]

    def location(self, entity: EntityRecord) -> EntityRecord | None:
        """在哪个地方：物在谁手里，就看那个人在哪（最多往上找三层）。"""
        current = entity
        for _ in range(4):
            place = self.places.get(current.id)
            if place is None:
                return None
            target = self.by_id.get(place[1])
            if target is None:
                return None
            if place[0] == "located_in":
                return target
            current = target
        return None

    def present(self, entity: EntityRecord) -> bool:
        if entity.is_protagonist:
            return True
        if entity.id in [str(p) for p in self.scene.get("present") or ()]:
            return True
        here = self.scene.get("location")
        place = self.location(entity)
        return bool(here) and place is not None and place.id == str(here)


def _names(entities: Sequence[EntityRecord]) -> str:
    return "、".join(f"“{e.name}”" for e in entities) or "（没有）"


def _where(world: _World, entity: EntityRecord) -> str:
    place = world.places.get(entity.id)
    if place is None:
        return f"“{entity.name}”没有位置"
    target = world.by_id.get(place[1])
    verb = "在" if place[0] == "located_in" else "在…手里："
    return f"“{entity.name}”{verb}“{target.name if target else place[1]}”"


def evaluate(check: Check, world: WorldRecords) -> CheckResult:
    w = _World(world)
    kind, args = check.kind, check.args
    if kind == "fact":
        keys = [normalize_name(a) for a in args]
        hits = [
            f.text
            for f in world.facts
            if f.status == "active" and all(k in normalize_name(f.text) for k in keys)
        ]
        detail = f"找到 {len(hits)} 条：{hits[0][:40]}" if hits else "没有这样的事实"
        return CheckResult(check, bool(hits), detail)
    first = w.find(args[0])
    if not first:
        return CheckResult(check, False, f"找不到“{args[0]}”")
    if kind in ("retired", "alive"):
        retired = [e for e in first if e.retired]
        passed = bool(retired) if kind == "retired" else len(retired) < len(first)
        state = "、".join(f"“{e.name}”{'已退场' if e.retired else '还在'}" for e in first)
        return CheckResult(check, passed, state)
    if kind in ("present", "absent", "gone"):
        here = [e for e in first if not e.retired and w.present(e)]
        if kind == "present":
            return CheckResult(check, bool(here), f"在场的：{_names(here)}")
        if kind == "absent":
            return CheckResult(check, not here, f"在场的：{_names(here)}")
        gone = all(e.retired or not w.present(e) for e in first)
        state = "、".join(
            f"“{e.name}”{'已退场' if e.retired else ('在场' if w.present(e) else '不在场')}"
            for e in first
        )
        return CheckResult(check, gone, state)
    second = w.find(args[1])
    if not second:
        return CheckResult(check, False, f"找不到“{args[1]}”")
    if kind in ("holds", "not_holds"):
        owners = {p.id for p in first}
        held = [
            i
            for i in second
            if (place := w.places.get(i.id)) is not None
            and place[0] == "held_by"
            and place[1] in owners
        ]
        passed = bool(held) if kind == "holds" else not held
        return CheckResult(check, passed, "；".join(_where(w, i) for i in second))
    if kind in ("at", "not_at"):
        key = normalize_name(args[1])
        matched = [
            e
            for e in first
            if (place := w.location(e)) is not None
            and any(key in normalize_name(n) for n in (place.name, *place.aliases))
        ]
        passed = bool(matched) if kind == "at" else not matched
        detail = "；".join(
            f"“{e.name}”在“{place.name}”" if (place := w.location(e)) else f"“{e.name}”没有位置"
            for e in first
        )
        return CheckResult(check, passed, detail)
    # together / apart：两边各取第一个能算出位置的
    a = next((e for e in first if w.location(e) is not None), first[0])
    b = next((e for e in second if w.location(e) is not None), second[0])
    pa, pb = w.location(a), w.location(b)
    same = pa is not None and pb is not None and pa.id == pb.id
    detail = (
        f"“{a.name}”在“{pa.name if pa else '（没有位置）'}”，"
        f"“{b.name}”在“{pb.name if pb else '（没有位置）'}”"
    )
    if kind == "apart" and b.retired:
        return CheckResult(check, True, f"“{b.name}”已退场")
    return CheckResult(check, same if kind == "together" else not same, detail)


def evaluate_all(
    checks: Sequence[Check], worlds: Mapping[int, WorldRecords], processed_to: int
) -> list[CheckResult]:
    results: list[CheckResult] = []
    for check in checks:
        world = worlds.get(check.after)
        if world is None or check.after > processed_to:
            results.append(CheckResult(check, False, f"世界状态没整理到第 {check.after} 回合"))
            continue
        results.append(evaluate(check, world))
    return results
