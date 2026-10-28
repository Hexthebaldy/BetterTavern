"""这一局的世界书快照（docs/lorebook.md 第 3.2 节）：开局时把剧本里几张卡自带的世界书和
剧本挂的世界书合成一份，存进 playthrough_lore。之后改卡、改书、换书都不影响这一局。

- 顺序：主角色卡的书、其余卡的书（按剧本里卡的顺序）、剧本挂的书（按挂的顺序）。在 SillyTavern 里
  这相当于“角色挂的几本书”：几本混在一起按优先级数字排（每回合怎么挑在 runtime/context/lore.py）。
- 停用的、没有正文的条目不要；标题和正文都一样的只留第一条（同一本书既在卡里又单独导入过）。
- 宏在这里替换：{{user}} 换成主角名；{{char}} 在卡的书里换成那张卡的角色名，在挂的书里换成主角色卡
  的角色名。关键词里的宏也换；其他宏删掉（和卡的其他文字一样）。
- 整份最多 MAX_ITEMS 条、MAX_CHARS 字，超出时从末尾往前丢（dropped 记丢了几条）。
- 有条目要“顺带扫描”卡的描述等文字时（rules.match），把这几段也存下来（宏替换好）。
"""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry, LoreMatch, apply_macros
from bettertavern.domain.scenario.edit import book_in_order

from .names import clean_display_name

MAX_ITEMS = 3000
MAX_CHARS = 600_000


class LoreItem(BaseModel):
    """快照里的一条：宏已经替换好的条目，加上它从哪来。"""

    model_config = ConfigDict(frozen=True)

    entry: LoreEntry
    source: str  # card / book
    source_name: str  # 卡的角色名或书名（排查用）
    card: int = 0  # 顺带扫描时扫哪张卡的文字：卡的书是那张卡，挂的书是主角色卡


class CardTexts(BaseModel):
    """一张卡里能“顺带扫描”的几段文字（只有用得着时才存）。"""

    model_config = ConfigDict(frozen=True)

    description: str = ""
    personality: str = ""
    scenario: str = ""
    creator_notes: str = ""
    depth_prompt: str = ""  # 角色备注

    def text(self, which: LoreMatch) -> str:
        return "" if which == "persona" else getattr(self, which)


class LoreSnapshot(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: tuple[LoreItem, ...] = ()
    user_name: str = ""  # 主角名：扫描时玩家行动前面带的名字
    char_name: str = ""  # 主角色卡的角色名：扫描时叙述前面带的名字
    persona: str = ""  # 主角介绍（rules.match 里的 persona）
    cards: tuple[CardTexts, ...] = ()  # 按剧本里卡的顺序；没有条目要顺带扫描时为空
    books: tuple[str, ...] = ()  # 合了哪几本挂的书（书名）
    dropped: int = 0  # 超过上限丢掉几条

    def chars(self) -> int:
        return sum(len(i.entry.content) for i in self.items)


def _macro_entry(entry: LoreEntry, *, user: str, char: str) -> LoreEntry:
    def text(value: str) -> str:
        return apply_macros(value, user=user, char=char).strip()

    def keys(values: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(dict.fromkeys(k for k in (text(v) for v in values) if k))

    return entry.model_copy(
        update={
            "name": text(entry.name),
            "content": text(entry.content),
            "keys": keys(entry.keys),
            "secondary_keys": keys(entry.secondary_keys),
        }
    )


def build_snapshot(
    cards: Sequence[CharacterCard],
    books: Sequence[tuple[str, Sequence[LoreEntry]]],
    *,
    protagonist_name: str,
    protagonist_summary: str = "",
) -> LoreSnapshot:
    """cards：剧本里的卡，按顺序（第一张是主角色卡）；books：剧本挂的书（书名，条目），按挂的顺序。"""
    user = clean_display_name(protagonist_name)
    lead = cards[0].name if cards else ""
    raw: list[LoreItem] = []
    for index, card in enumerate(cards):
        for entry in book_in_order(card.book):
            raw.append(
                LoreItem(
                    entry=_macro_entry(entry, user=user, char=card.name),
                    source="card",
                    source_name=card.name,
                    card=index,
                )
            )
    for name, entries in books:
        for entry in sorted(entries, key=lambda e: e.order):
            raw.append(
                LoreItem(
                    entry=_macro_entry(entry, user=user, char=lead), source="book", source_name=name
                )
            )
    seen: set[tuple[str, str]] = set()
    items: list[LoreItem] = []
    for item in raw:
        entry = item.entry
        if not entry.enabled or not entry.content:
            continue
        key = (" ".join(entry.name.split()), " ".join(entry.content.split()))
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
    kept = items[:MAX_ITEMS]
    total = sum(len(i.entry.content) for i in kept)
    while kept and total > MAX_CHARS:
        total -= len(kept.pop().entry.content)
    needs_texts = any(i.entry.rules is not None and i.entry.rules.match for i in kept)
    return LoreSnapshot(
        items=tuple(kept),
        user_name=user,
        char_name=lead,
        persona=apply_macros(protagonist_summary, user=user, char=lead).strip()
        if needs_texts
        else "",
        cards=tuple(_card_texts(card, user) for card in cards) if needs_texts else (),
        books=tuple(name for name, _ in books),
        dropped=len(items) - len(kept),
    )


def _card_texts(card: CharacterCard, user: str) -> CardTexts:
    def text(value: str) -> str:
        return apply_macros(value, user=user, char=card.name).strip()

    return CardTexts(
        description=text(card.description),
        personality=text(card.personality),
        scenario=text(card.scenario),
        creator_notes=text(card.creator_notes),
        depth_prompt=text(card.depth_prompt),
    )
