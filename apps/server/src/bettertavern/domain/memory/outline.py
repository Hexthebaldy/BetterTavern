"""大纲（docs/agent-runtime.md 第 4 节“大纲修订”）：故事的前提、接下来几拍、约束。

大纲由后台的大纲修订写，导演只拿它把握方向：玩家的行动永远优先，玩家走偏了就改大纲去跟玩家。
模型写出的大纲先过 settle()：截掉过长的文字、去掉多余的拍和约束，再按规则修正：
- 上一版已经完成的拍不能改回没完成；
- 完成和跳过的拍只留最近两拍（更早的在以前的修订里都有），免得越积越多、把待写的拍挤掉；
- 只能有一拍“进行中”：一拍都没有时，第一拍待写的变成进行中；多于一拍时只留最前面的一拍。
修正是确定的，不再交回模型。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

STATUSES: tuple[str, ...] = ("pending", "active", "done", "skipped")
MAX_BEATS = 10
KEPT_FINISHED = 2  # 完成和跳过的拍只留最近几拍
FINISHED = ("done", "skipped")
MAX_CONSTRAINTS = 6
PREMISE_CHARS = 200
BEAT_CHARS = 200
CONSTRAINT_CHARS = 160


class Beat(BaseModel):
    id: str
    status: str = "pending"  # pending 待写 / active 进行中 / done 完成 / skipped 跳过
    intent: str
    done_when: str = ""


class Outline(BaseModel):
    premise: str
    beats: list[Beat] = Field(min_length=1)
    constraints: list[str] = Field(default_factory=list)


def _clean(text: Any, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


def settle(new: Outline, old: Outline | None = None) -> Outline:
    """截长、去重、按规则修正（见模块说明）。"""
    done_before = {b.id for b in old.beats if b.status == "done"} if old else set()
    beats: list[Beat] = []
    seen: set[str] = set()
    for index, beat in enumerate(new.beats, 1):
        beat_id = _clean(beat.id, 20) or f"b{index}"
        if beat_id in seen:
            beat_id = f"b{index}"
        seen.add(beat_id)
        status = beat.status if beat.status in STATUSES else "pending"
        if beat_id in done_before:
            status = "done"
        beats.append(
            Beat(
                id=beat_id,
                status=status,
                intent=_clean(beat.intent, BEAT_CHARS),
                done_when=_clean(beat.done_when, BEAT_CHARS),
            )
        )
    finished = [b for b in beats if b.status in FINISHED]
    dropped = {id(b) for b in finished[: max(len(finished) - KEPT_FINISHED, 0)]}
    beats = [b for b in beats if id(b) not in dropped][:MAX_BEATS]
    active = [b for b in beats if b.status == "active"]
    if not active:
        first = next((b for b in beats if b.status == "pending"), None)
        if first is not None:
            first.status = "active"
    for extra in active[1:]:
        extra.status = "pending"
    constraints = [c for c in (_clean(c, CONSTRAINT_CHARS) for c in new.constraints) if c]
    return Outline(
        premise=_clean(new.premise, PREMISE_CHARS),
        beats=beats,
        constraints=constraints[:MAX_CONSTRAINTS],
    )


@dataclass(frozen=True, slots=True)
class OutlineSlice:
    """导演每回合看到的那一部分：前提、当前这一拍、下一拍（仅供把握走向）、全部约束。"""

    premise: str
    current: Beat | None
    upcoming: Beat | None
    constraints: tuple[str, ...]


def slice_of(outline: Outline) -> OutlineSlice:
    current = next((b for b in outline.beats if b.status == "active"), None)
    upcoming: Beat | None = None
    if current is not None:
        after = outline.beats[outline.beats.index(current) + 1 :]
        upcoming = next((b for b in after if b.status == "pending"), None)
    return OutlineSlice(
        premise=outline.premise,
        current=current,
        upcoming=upcoming,
        constraints=tuple(outline.constraints),
    )


def outline_from_json(data: Mapping[str, Any] | None) -> Outline | None:
    """库里存的大纲（outline_revisions.content）；没有或者坏了时返回 None。"""
    if not data:
        return None
    try:
        return Outline.model_validate(data)
    except ValueError:
        return None
