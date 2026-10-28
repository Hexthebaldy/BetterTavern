"""开局时剧本里每张卡的原文快照（存在 playthroughs.seed 的 cards 键里）。

两种用处（docs/agent-runtime.md 的“卡作者的指令”和“闪电模式”）：
- 卡作者写给模型的指令（系统提示、历史后置指令、角色备注）和对话示例：两种模式的导演都看；
- 描述、性格、场景：只有闪电模式放进导演的系统提示（普通模式开局时已经整理进世界状态）。

- 开局搭世界时写入，之后改卡不影响这一局；系统提示开局后不变，前缀缓存一直有效。
- 宏（{{user}}、{{char}}）在这里换成主角名和角色名，其他宏去掉，包括 SillyTavern 的
  {{original}}（“在这里插入默认的系统提示”：我们自己的规则一直都在）；世界书里停用的、没有内容的条目不要。
- 几张卡里换完名字以后一字不差的指令只留第一张卡的。
- 世界书功能上线（2026-10-25）以后开的局不放卡里的世界书（lore=False）：世界书和剧本挂的一起
  走世界书快照（domain/world/lore.py），按关键词带进上下文；以前开的闪电存档快照里还有。
- 各部分的上限各算各的，超出时 truncated 记为真：
  - 系统提示每张卡 INSTRUCTION_CHARS 字、合计 INSTRUCTIONS_CHARS 字，截掉结尾；
  - 后置指令和角色备注合计 REMINDER_CHARS 字（每回合都在最后一条消息里，按全价算），
    从最后一张卡往前截；
  - 对话示例合计 EXAMPLES_CHARS 字，按段（<START> 分开的）从最后一张卡的最后一段往前去掉，
    只剩一段时截短它；
  - 描述、性格、场景和卡里的世界书合计 CARD_SOURCE_CHARS 字，依次：去掉世界书里不是常驻的条目、
    去掉常驻条目、截短场景、性格、描述，每一步都从最后一张卡往前，够了就停。
- F2（2026-10-28）以前开的局快照里没有指令，读出来是空的；对话示例从 2026-10-25 起就存了。
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence

from pydantic import BaseModel, ConfigDict

from bettertavern.domain.scenario.card import CharacterCard, apply_macros

from .names import clean_display_name

CARD_SOURCE_CHARS = 15_000
INSTRUCTION_CHARS = 3_000
INSTRUCTIONS_CHARS = 6_000
REMINDER_CHARS = 1_500
EXAMPLES_CHARS = 6_000
LORE_NAME_CHARS = 80

# 超出上限时按这个顺序截短的字段（每张卡里的）
_CLIP_ORDER = ("scenario", "personality", "description")
_START = re.compile(r"<START>", re.IGNORECASE)


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
    examples: str = ""  # 对话示例（mes_example），段与段之间是 <START>
    lore: tuple[LoreText, ...] = ()
    system_prompt: str = ""
    post_history_instructions: str = ""
    depth_prompt: str = ""  # 角色备注

    def source_chars(self) -> int:
        """闪电模式里“卡的原文”那一节的字数（CARD_SOURCE_CHARS 管的部分）"""
        return (
            len(self.description)
            + len(self.personality)
            + len(self.scenario)
            + sum(e.chars() for e in self.lore)
        )

    def chars(self) -> int:
        return (
            self.source_chars()
            + len(self.examples)
            + len(self.system_prompt)
            + len(self.post_history_instructions)
            + len(self.depth_prompt)
        )

    def reminder(self) -> str:
        """放在最后一条消息里的提醒：后置指令在前，角色备注在后"""
        return "\n\n".join(t for t in (self.post_history_instructions, self.depth_prompt) if t)


class CardSource(BaseModel):
    model_config = ConfigDict(frozen=True)

    cards: tuple[CardText, ...] = ()
    truncated: bool = False  # 有一部分超过上限，按上面的规则截过

    def chars(self) -> int:
        return sum(c.chars() for c in self.cards)


def example_blocks(text: str) -> list[str]:
    """对话示例按 <START> 分成几段；空的段不要。"""
    return [block.strip() for block in _START.split(text) if block.strip()]


def fit_examples(
    groups: Sequence[Sequence[str]], *, limit: int, size: Callable[[str], int] = len
) -> tuple[list[list[str]], bool]:
    """几张卡的对话示例（每张卡一组段落）合计不超过 limit：从最后一组的最后一段往前去掉；
    只剩一段还超的截短它的结尾。size 是怎么算长短（字数，或者估算的 token）。返回结果和截没截过。"""
    flat = [(i, block) for i, blocks in enumerate(groups) for block in blocks]
    total = sum(size(block) for _, block in flat)
    cut = False
    while len(flat) > 1 and total > limit:
        total -= size(flat.pop()[1])
        cut = True
    if flat and total > limit:
        index, block = flat[0]
        keep = max(0, len(block) * limit // max(total, 1))
        flat[0] = (index, block[:keep].rstrip())
        flat = [item for item in flat if item[1]]
        cut = True
    result: list[list[str]] = [[] for _ in groups]
    for index, block in flat:
        result[index].append(block)
    return result, cut


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
        system_prompt=text(card.system_prompt),
        post_history_instructions=text(card.post_history_instructions),
        depth_prompt=text(card.depth_prompt),
    )


def _dedupe(cards: list[CardText], field: str) -> None:
    """换完名字以后一字不差的指令只留第一张卡的"""
    seen: set[str] = set()
    for i, card in enumerate(cards):
        value: str = getattr(card, field)
        if value in seen:
            cards[i] = card.model_copy(update={field: ""})
        elif value:
            seen.add(value)


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


def _clip_total(cards: list[CardText], fields: Sequence[str], limit: int) -> bool:
    """几个字段合计不超过 limit：从最后一张卡往前、每张卡里从后一个字段往前截。"""
    over = sum(len(getattr(c, f)) for c in cards for f in fields) - limit
    if over <= 0:
        return False
    for i in reversed(range(len(cards))):
        one = [cards[i]]
        for field in reversed(fields):
            over = _clip_field(one, over, field)
        cards[i] = one[0]
        if over <= 0:
            break
    return True


def _clip_instructions(cards: list[CardText]) -> bool:
    cut = False
    for i, card in enumerate(cards):
        if len(card.system_prompt) > INSTRUCTION_CHARS:
            clipped = card.system_prompt[:INSTRUCTION_CHARS].rstrip()
            cards[i] = card.model_copy(update={"system_prompt": clipped})
            cut = True
    return _clip_total(cards, ("system_prompt",), INSTRUCTIONS_CHARS) or cut


def _fit_examples(cards: list[CardText]) -> bool:
    groups, cut = fit_examples([example_blocks(c.examples) for c in cards], limit=EXAMPLES_CHARS)
    if cut:
        for i, blocks in enumerate(groups):
            text = "\n".join(f"<START>\n{block}" for block in blocks)
            cards[i] = cards[i].model_copy(update={"examples": text})
    return cut


def _fit_source(cards: list[CardText], limit: int) -> bool:
    over = sum(c.source_chars() for c in cards) - limit
    if over <= 0:
        return False
    over = _drop_lore(cards, over, constant=False)
    over = _drop_lore(cards, over, constant=True)
    for field in _CLIP_ORDER:
        over = _clip_field(cards, over, field)
    return True


def snapshot_cards(
    cards: Sequence[CharacterCard],
    *,
    protagonist_name: str,
    limit: int = CARD_SOURCE_CHARS,
    lore: bool = True,
) -> CardSource:
    """limit 是描述、性格、场景和卡里世界书的合计上限（其余几部分的上限见模块说明）。"""
    user = clean_display_name(protagonist_name)
    texts = [_card_text(card, user) for card in cards]
    if not lore:
        texts = [t.model_copy(update={"lore": ()}) for t in texts]
    for field in ("system_prompt", "post_history_instructions", "depth_prompt"):
        _dedupe(texts, field)
    cut = [
        _clip_instructions(texts),
        _clip_total(texts, ("post_history_instructions", "depth_prompt"), REMINDER_CHARS),
        _fit_examples(texts),
        _fit_source(texts, limit),
    ]
    return CardSource(cards=tuple(texts), truncated=any(cut))
