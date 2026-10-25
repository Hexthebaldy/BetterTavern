"""开局时剧本里每张卡的原文快照（存在 playthroughs.seed 的 cards 键里）。

闪电模式不在后台整理世界状态，导演从系统提示里的这份原文了解人物和世界
（docs/agent-runtime.md 的“闪电模式”）。

- 开局搭世界时写入，之后改卡不影响这一局；系统提示开局后不变，前缀缓存一直有效。
- 宏（{{user}}、{{char}}）在这里换成主角名和角色名；世界书里停用的、没有内容的条目不要。
- 世界书功能上线（2026-10-25）以后开的局不放卡里的世界书（lore=False）：世界书和剧本挂的一起
  走世界书快照（domain/world/lore.py），按关键词带进上下文；以前开的闪电存档快照里还有。
- 整份最多 CARD_SOURCE_CHARS 字，超出时依次：去掉世界书里不是常驻的条目、截短对话示例、
  去掉常驻条目、截短场景、性格、描述，每一步都从最后一张卡往前，够了就停；truncated 记为真。
"""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict

from bettertavern.domain.scenario.card import CharacterCard, apply_macros

from .names import clean_display_name

CARD_SOURCE_CHARS = 15_000
LORE_NAME_CHARS = 80

# 超出上限时按这个顺序截短的字段（每张卡里的）
_CLIP_ORDER = ("scenario", "personality", "description")


class LoreText(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = ""
    content: str
    constant: bool = False

    def chars(self) -> int:
        return len(self.name) + len(self.content)


class CardText(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    examples: str = ""  # 对话示例（mes_example）
    lore: tuple[LoreText, ...] = ()

    def chars(self) -> int:
        return (
            len(self.description)
            + len(self.personality)
            + len(self.scenario)
            + len(self.examples)
            + sum(e.chars() for e in self.lore)
        )


class CardSource(BaseModel):
    model_config = ConfigDict(frozen=True)

    cards: tuple[CardText, ...] = ()
    truncated: bool = False  # 超过上限，按上面的顺序截过

    def chars(self) -> int:
        return sum(c.chars() for c in self.cards)


def _card_text(card: CharacterCard, user: str) -> CardText:
    def text(value: str) -> str:
        return apply_macros(value, user=user, char=card.name).strip()

    lore = tuple(
        LoreText(
            name=text(entry.name)[:LORE_NAME_CHARS],
            content=text(entry.content),
            constant=entry.constant,
        )
        for entry in card.book
        if entry.enabled and entry.content.strip()
    )
    return CardText(
        name=card.name,
        description=text(card.description),
        personality=text(card.personality),
        scenario=text(card.scenario),
        examples=text(card.mes_example),
        lore=tuple(e for e in lore if e.content),
    )


def _drop_lore(cards: list[CardText], over: int, *, constant: bool) -> int:
    """从最后一张卡的最后一条往前去掉常驻（或不常驻）的条目，直到不超；返回还超出多少。"""
    for i in reversed(range(len(cards))):
        kept = list(cards[i].lore)
        for j in reversed(range(len(kept))):
            if over <= 0:
                break
            if kept[j].constant is constant:
                over -= kept[j].chars()
                del kept[j]
        cards[i] = cards[i].model_copy(update={"lore": tuple(kept)})
        if over <= 0:
            break
    return over


def _clip_field(cards: list[CardText], over: int, field: str) -> int:
    """从最后一张卡往前截短某个字段的结尾，直到不超；返回还超出多少。"""
    for i in reversed(range(len(cards))):
        if over <= 0:
            break
        value: str = getattr(cards[i], field)
        clipped = value[: max(0, len(value) - over)].rstrip()
        over -= len(value) - len(clipped)
        cards[i] = cards[i].model_copy(update={field: clipped})
    return over


def snapshot_cards(
    cards: Sequence[CharacterCard],
    *,
    protagonist_name: str,
    limit: int = CARD_SOURCE_CHARS,
    lore: bool = True,
) -> CardSource:
    user = clean_display_name(protagonist_name)
    texts = [_card_text(card, user) for card in cards]
    if not lore:
        texts = [t.model_copy(update={"lore": ()}) for t in texts]
    over = sum(t.chars() for t in texts) - limit
    if over <= 0:
        return CardSource(cards=tuple(texts))
    over = _drop_lore(texts, over, constant=False)
    over = _clip_field(texts, over, "examples")
    over = _drop_lore(texts, over, constant=True)
    for field in _CLIP_ORDER:
        over = _clip_field(texts, over, field)
    return CardSource(cards=tuple(texts), truncated=True)
