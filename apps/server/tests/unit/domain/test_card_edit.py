"""导入后编辑角色卡的规则：能改什么、上限、被截断记录、世界书顺序。"""

from __future__ import annotations

import pytest

from bettertavern.domain.scenario.card import (
    MAX_BOOK_ENTRIES,
    MAX_FIELD_CHARS,
    MAX_TOTAL_CHARS,
    CharacterCard,
    LoreEntry,
)
from bettertavern.domain.scenario.edit import (
    CardEdit,
    EditError,
    LoreEntryEdit,
    apply_edit,
    book_in_order,
    changed_fields,
)

CARD = CharacterCard(
    spec="card_v2",
    name="阿苓",
    description="酒馆的帮工",
    personality="嘴硬心软",
    first_mes="外乡人？",
    system_prompt="原样保留的系统提示",
    alternate_greetings=("备选开场白",),
    creator="某作者",
    tags=("酒馆",),
    book=(
        LoreEntry(name="商会", keys=("北境",), content="北境商会的火漆是黑色的", order=20),
        LoreEntry(name="渡口", content="子时才有船", constant=True, order=5),
    ),
    truncated=("description", "system_prompt"),
)


def edit_of(card: CharacterCard, **changes: object) -> CardEdit:
    """拿卡片现在的内容当作编辑的起点，再按 changes 改几项"""
    base = {
        "name": card.name,
        "description": card.description,
        "personality": card.personality,
        "scenario": card.scenario,
        "first_mes": card.first_mes,
        "mes_example": card.mes_example,
        "tags": card.tags,
        "book": tuple(
            LoreEntryEdit(
                name=e.name, keys=e.keys, content=e.content, enabled=e.enabled, constant=e.constant
            )
            for e in book_in_order(card.book)
        ),
    }
    base.update(changes)
    return CardEdit(**base)  # type: ignore[arg-type]


def test_edits_the_open_fields_and_keeps_the_rest() -> None:
    after = apply_edit(
        CARD,
        edit_of(
            CARD, name="  阿苓（改）", description="新的描述\r\n第二行", tags=("酒馆", " 雨夜 ")
        ),
    )
    assert after.name == "阿苓（改）"
    assert after.description == "新的描述\n第二行"
    assert after.tags == ("酒馆", "雨夜")
    # 没开放的字段原样保留
    assert after.system_prompt == "原样保留的系统提示"
    assert after.alternate_greetings == ("备选开场白",)
    assert after.creator == "某作者"
    assert changed_fields(CARD, after) == ["name", "description", "tags"]


def test_edited_fields_are_no_longer_marked_truncated() -> None:
    after = apply_edit(CARD, edit_of(CARD, description="重写过了"))
    assert after.truncated == ("system_prompt",)
    unchanged = apply_edit(CARD, edit_of(CARD))
    assert unchanged.truncated == ("description", "system_prompt")


def test_book_keeps_its_order_and_is_renumbered() -> None:
    # 编辑页按 order 显示：渡口（5）在商会（20）前面；保存时按列表顺序重新编号
    unchanged = apply_edit(CARD, edit_of(CARD))
    assert [(e.name, e.order) for e in unchanged.book] == [("渡口", 0), ("商会", 1)]
    assert changed_fields(CARD, unchanged) == []

    entries = edit_of(CARD).book
    added = LoreEntryEdit(name="新条目", keys=("钥匙", " ", "钥匙"), content="  内容  ")
    after = apply_edit(CARD, edit_of(CARD, book=(added, *entries[1:])))
    assert [(e.name, e.order) for e in after.book] == [("新条目", 0), ("商会", 1)]
    assert after.book[0].keys == ("钥匙",) and after.book[0].content == "内容"
    assert changed_fields(CARD, after) == ["book"]


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"name": "   "}, "name"),
        ({"name": "名" * 81}, "name"),
        ({"description": "字" * (MAX_FIELD_CHARS + 1)}, "description"),
        ({"tags": tuple(f"标签{i}" for i in range(33))}, "tags"),
        ({"tags": ("长" * 41,)}, "tags"),
        ({"book": (LoreEntryEdit(content="  "),)}, "book.0.content"),
        ({"book": (LoreEntryEdit(content="有", name="名" * 121),)}, "book.0.name"),
        (
            {"book": (LoreEntryEdit(content="有", keys=tuple(str(i) for i in range(65))),)},
            "book.0.keys",
        ),
        ({"book": tuple(LoreEntryEdit(content="有") for _ in range(MAX_BOOK_ENTRIES + 1))}, "book"),
    ],
)
def test_rejects_with_the_offending_field(changes: dict[str, object], field: str) -> None:
    with pytest.raises(EditError) as info:
        apply_edit(CARD, edit_of(CARD, **changes))
    assert info.value.field == field


def test_rejects_cards_over_the_total_limit() -> None:
    each = MAX_FIELD_CHARS
    fields = ("description", "personality", "scenario", "first_mes", "mes_example")
    big = {name: "字" * each for name in fields}
    # 五个字段各 6 万字正好 30 万，再加一条世界书就超了
    over = edit_of(CARD, **big, book=(LoreEntryEdit(content="多出来的"),))
    with pytest.raises(EditError) as info:
        apply_edit(CARD.model_copy(update={"system_prompt": ""}), over)
    assert info.value.field == "card"
    assert str(MAX_TOTAL_CHARS) in info.value.message


def test_strips_nul_characters() -> None:
    after = apply_edit(CARD, edit_of(CARD, description="有\x00空字符"))
    assert after.description == "有空字符"
