"""剧本的设置（scenarios.setup）：默认主角、偏好、用哪张卡的哪条开场白、是不是闪电模式。

开新故事时用它预填没填的字段；opening 为空时由导演写开场。
这里只做形状和长度的规整；opening 指向的卡是否在剧本里、开场白编号是否存在，
由 opening_problem 检查。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .card import CharacterCard

MAX_PROTAGONIST_NAME = 40
MAX_PROTAGONIST_SUMMARY = 400
MAX_STYLE = 200
MAX_BOUNDARIES = 300
MAX_SCENARIO_CARDS = 8

Length = Literal["short", "medium", "long"]


@dataclass(frozen=True, slots=True)
class Opening:
    card_id: str
    greeting: int  # 0 是 first_mes，1 起是备选开场白


@dataclass(frozen=True, slots=True)
class ScenarioSetup:
    protagonist_name: str = ""
    protagonist_summary: str = ""
    length: Length = "medium"
    style: str = ""
    boundaries: str = ""
    opening: Opening | None = None
    # 闪电模式：这个剧本开的新故事不在后台整理世界状态（domain/story/mode.py）；
    # 已经开始的故事不受影响
    lightning: bool = False

    @classmethod
    def from_json(cls, data: Mapping[str, Any] | None) -> ScenarioSetup:
        data = data or {}
        protagonist = data.get("protagonist") or {}
        preferences = data.get("preferences") or {}
        opening = data.get("opening") or None
        length = preferences.get("length") if isinstance(preferences, Mapping) else None
        parsed_opening: Opening | None = None
        if isinstance(opening, Mapping) and opening.get("card_id"):
            try:
                greeting = max(int(opening.get("greeting") or 0), 0)
            except (TypeError, ValueError):
                greeting = 0
            parsed_opening = Opening(card_id=str(opening["card_id"]), greeting=greeting)
        if not isinstance(protagonist, Mapping):
            protagonist = {}
        if not isinstance(preferences, Mapping):
            preferences = {}
        return cls(
            protagonist_name=_clean(protagonist.get("name"), MAX_PROTAGONIST_NAME),
            protagonist_summary=_clean(protagonist.get("summary"), MAX_PROTAGONIST_SUMMARY),
            length=length if length in ("short", "medium", "long") else "medium",
            style=_clean(preferences.get("style"), MAX_STYLE),
            boundaries=_clean(preferences.get("boundaries"), MAX_BOUNDARIES),
            opening=parsed_opening,
            lightning=data.get("lightning") is True,
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "protagonist": {"name": self.protagonist_name, "summary": self.protagonist_summary},
            "preferences": {
                "length": self.length,
                "style": self.style,
                "boundaries": self.boundaries,
            },
            "opening": (
                None
                if self.opening is None
                else {"card_id": self.opening.card_id, "greeting": self.opening.greeting}
            ),
            "lightning": self.lightning,
        }


def _clean(value: Any, limit: int) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()[:limit]


def greetings_of(card: CharacterCard) -> list[str]:
    """按编号排的开场白：0 是 first_mes，1 起是备选开场白。"""
    return [card.first_mes, *card.alternate_greetings]


def opening_problem(
    opening: Opening | None, cards: Sequence[tuple[str, CharacterCard]]
) -> str | None:
    """opening 指向的卡要在剧本里，开场白编号要存在且不是空的；没问题返回 None。"""
    if opening is None:
        return None
    for card_id, card in cards:
        if card_id == opening.card_id:
            greetings = greetings_of(card)
            if opening.greeting >= len(greetings) or not greetings[opening.greeting].strip():
                return "The chosen greeting doesn't exist on that card"
            return None
    return "The opening must use one of this scenario's cards"
