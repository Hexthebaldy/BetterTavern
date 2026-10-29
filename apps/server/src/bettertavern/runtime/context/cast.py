"""多角色的局拼上下文要用的几样（docs/cast.md，装配在 assembler.py）。

- 角色和世界状态里的人物按名字对上（名字或别名归一化以后相同）：在场的角色、“行动里提到了谁”
  多认的叫法、写某个角色时状态块只给他看他知道的，都靠这个；对不上的角色当作不在场、只看公开的事实。
- 最后一条消息里的角色卡内容：角色那一段只有他自己的卡（原文、卡作者的指令、对话示例），
  旁白、开场、结局是每张卡的指令（闪电模式没有世界状态，再加上卡的原文；开场、结局再加上对话示例）。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.story.cast import CastMember, Segment, Speaker
from bettertavern.domain.world.card_source import (
    EXAMPLES_CHARS,
    CardText,
    example_blocks,
    fit_examples,
)
from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.views import EntityView, WorldSnapshot

from .fences import sanitize_for_fence
from .tokens import estimate_tokens

EXAMPLES_RATIO = 0.10  # 对话示例最多占窗口的这么多（和导演一样）


@dataclass(frozen=True)
class CastRole:
    """这一次请求写谁：speaker 是角色的位置，旁白是 None；earlier 是这一回合前面已经写好的几段。"""

    speaker: Speaker
    earlier: tuple[Segment, ...] = ()


def cast_entities(world: WorldSnapshot, cast: Sequence[CastMember]) -> dict[int, EntityView]:
    """每个角色在世界状态里是哪个人物（对不上的不在结果里）。"""
    people = [e for e in world.entities if e.kind == "character" and not e.is_protagonist]
    found: dict[int, EntityView] = {}
    for member in cast:
        key = normalize_name(member.name)
        if not key:
            continue
        match = next(
            (
                e
                for e in people
                if key == normalize_name(e.name) or key in {normalize_name(a) for a in e.aliases}
            ),
            None,
        )
        if match is not None:
            found[member.position] = match
    return found


def present_positions(world: WorldSnapshot, cast: Sequence[CastMember]) -> set[int]:
    """此刻在场的角色（按世界状态里的场景）。"""
    _, present = world.scene()
    ids = {p.id for p in present}
    return {pos for pos, entity in cast_entities(world, cast).items() if entity.id in ids}


def cast_aliases(world: WorldSnapshot, cast: Sequence[CastMember]) -> dict[int, tuple[str, ...]]:
    """每个角色除了名字以外的叫法（世界状态里那个人物的名字和别名）。"""
    return {
        pos: (entity.name, *entity.aliases) for pos, entity in cast_entities(world, cast).items()
    }


def card_texts(
    cards: Sequence[CardText],
    window: int,
    *,
    source: bool,
    examples: bool,
) -> list[dict[str, Any]]:
    """几张卡给最后一条消息的内容（_card_texts.j2）：卡作者的指令总是有，
    source 为真时带上描述、性格、场景，examples 为真时带上对话示例（按字数和窗口限过）。"""
    groups: list[list[str]] = [[] for _ in cards]
    if examples:
        groups = [example_blocks(c.examples) for c in cards]
        groups, _ = fit_examples(groups, limit=EXAMPLES_CHARS)
        budget = math.floor(window * EXAMPLES_RATIO)
        groups, _ = fit_examples(groups, limit=budget, size=estimate_tokens)
    texts: list[dict[str, Any]] = []
    for card, blocks in zip(cards, groups, strict=True):
        item = {
            "name": sanitize_for_fence(card.name),
            "description": sanitize_for_fence(card.description) if source else "",
            "personality": sanitize_for_fence(card.personality) if source else "",
            "scenario": sanitize_for_fence(card.scenario) if source else "",
            "instructions": sanitize_for_fence(card.system_prompt),
            "examples": [sanitize_for_fence(b) for b in blocks],
        }
        if (
            any(item[k] for k in ("description", "personality", "scenario", "instructions"))
            or (item["examples"])
        ):
            texts.append(item)
    return texts
