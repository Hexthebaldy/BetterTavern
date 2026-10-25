"""这一局的世界书快照（docs/lorebook.md 第 3.2 节）：几张卡的书和挂的书怎么合、宏怎么换、
去重和上限。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import CharacterCard, LoreEntry, LoreRules
from bettertavern.domain.world import lore
from bettertavern.domain.world.lore import build_snapshot

LEAD = CharacterCard(
    spec="card_v3",
    name="沈知微",
    description="{{char}} 是渡口茶馆的掌柜",
    book=(
        LoreEntry(name="茶馆", keys=("茶馆",), content="{{char}} 的茶馆只卖粗茶", order=1),
        LoreEntry(name="停用", keys=("x",), content="不要", enabled=False, order=0),
        LoreEntry(name="空的", keys=("y",), content="  ", order=2),
    ),
)
OTHER = CharacterCard(
    spec="card_v3",
    name="撑篙人",
    book=(LoreEntry(name="船", keys=("{{char}}",), content="{{char}} 认识 {{user}}"),),
)
BOOK = (
    LoreEntry(
        name="茶馆", content="{{char}} 的茶馆只卖粗茶", keys=("茶馆",), order=0
    ),  # 和卡里的一样
    LoreEntry(name="渡口", keys=("渡口",), content="{{user}} 每晚都来{{random::甲::乙}}", order=1),
)


def test_cards_then_books_with_macros_replaced() -> None:
    snapshot = build_snapshot(
        [LEAD, OTHER], [("青石渡", BOOK)], protagonist_name="林川", protagonist_summary="外乡人"
    )
    assert [(i.source, i.source_name, i.card) for i in snapshot.items] == [
        ("card", "沈知微", 0),
        ("card", "撑篙人", 1),
        ("book", "青石渡", 0),
    ]
    tea, boat, ferry = (i.entry for i in snapshot.items)
    assert tea.content == "沈知微 的茶馆只卖粗茶"
    # 卡的书按那张卡换 {{char}}，关键词里的宏也换
    assert boat.keys == ("撑篙人",) and boat.content == "撑篙人 认识 林川"
    # 挂的书里 {{char}} 是主角色；其他宏删掉；和卡里一模一样的条目只留第一条
    assert ferry.content == "林川 每晚都来"
    assert (snapshot.user_name, snapshot.char_name, snapshot.books) == (
        "林川",
        "沈知微",
        ("青石渡",),
    )
    # 没有条目要顺带扫描时，不存卡的文字和主角介绍
    assert snapshot.cards == () and snapshot.persona == ""


def test_texts_for_match_are_kept_only_when_needed() -> None:
    entry = LoreEntry(keys=("掌柜",), content="内容", rules=LoreRules(match=("description",)))
    card = LEAD.model_copy(update={"book": (entry,)})
    snapshot = build_snapshot(
        [card], [], protagonist_name="林川", protagonist_summary="{{user}}，外乡人"
    )
    assert snapshot.cards[0].description == "沈知微 是渡口茶馆的掌柜"
    assert snapshot.persona == "林川，外乡人"


def test_limits_drop_from_the_end(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(lore, "MAX_ITEMS", 2)
    many = tuple(LoreEntry(name=str(i), keys=("k",), content=f"第{i}条", order=i) for i in range(4))
    snapshot = build_snapshot([], [("书", many)], protagonist_name="林川")
    assert [i.entry.name for i in snapshot.items] == ["0", "1"] and snapshot.dropped == 2
    monkeypatch.setattr(lore, "MAX_ITEMS", 100)
    monkeypatch.setattr(lore, "MAX_CHARS", 7)
    snapshot = build_snapshot([], [("书", many)], protagonist_name="林川")
    assert [i.entry.name for i in snapshot.items] == ["0", "1"] and snapshot.dropped == 2
