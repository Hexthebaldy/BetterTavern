"""保存前的检查：error 挡住保存，warning 只提示（和客户端 cardEdit.ts 的 code 一致）。"""

from __future__ import annotations

from bettertavern.domain.scenario.card import MAX_FIELD_CHARS, CharacterCard, LoreEntry
from bettertavern.domain.scenario.check import blocking, check_card

GOOD = CharacterCard(
    spec="card_v3",
    name="温九",
    description="长生当的掌柜，{{char}} 收的是人的念想。",
    first_mes="（{{user}} 推门进来）客官当什么？",
    book=(
        LoreEntry(name="长生当", keys=("当铺", "长生当"), content="城南的当铺", order=0),
        LoreEntry(name="规矩", content="三不当", constant=True, order=1),
    ),
)


def codes(card: CharacterCard, display_name: str = "温九") -> list[tuple[str, str, str]]:
    return [(i.field, i.code, i.level) for i in check_card(card, display_name=display_name)]


def test_a_complete_card_has_no_issues() -> None:
    assert codes(GOOD) == []


def test_errors_block_saving() -> None:
    card = GOOD.model_copy(
        update={
            "name": " ",
            "alternate_greetings": ("",),
            "book": (LoreEntry(name="空的", keys=("钥匙",), content=""),),
        }
    )
    issues = check_card(card, display_name="")
    assert [(i.field, i.code) for i in blocking(issues)] == [
        ("display_name", "display_name_empty"),
        ("name", "name_empty"),
        ("alternate_greetings.0", "greeting_empty"),
        ("book.0.content", "entry_empty"),
    ]


def test_too_long_fields_are_errors() -> None:
    card = GOOD.model_copy(update={"personality": "字" * (MAX_FIELD_CHARS + 1)})
    assert ("personality", "field_too_long", "error") in codes(card)


def test_warnings_point_at_likely_mistakes() -> None:
    card = GOOD.model_copy(
        update={
            "description": "",
            "first_mes": "",
            "scenario": "{{usr}} 走进当铺",
            "personality": "{{char} 话很少",
            "book": (
                LoreEntry(name="长生当", keys=("当铺",), content="城南的当铺", order=0),
                LoreEntry(name="当铺二", keys=("当铺",), content="重复的关键词", order=1),
                LoreEntry(name="孤零零", content="没有关键词也不常驻", order=2),
            ),
        }
    )
    found = codes(card)
    assert ("description", "description_empty", "warning") in found
    assert ("first_mes", "opening_empty", "warning") in found
    assert ("scenario", "macro_unknown", "warning") in found
    assert ("personality", "macro_broken", "warning") in found
    assert ("book.1.keys", "key_duplicate", "warning") in found
    assert ("book.2.keys", "entry_unreachable", "warning") in found
    assert blocking(check_card(card, display_name="温九")) == []


def test_disabled_entries_without_keys_are_fine() -> None:
    card = GOOD.model_copy(
        update={"book": (LoreEntry(name="停用的", content="暂时不用", enabled=False),)}
    )
    assert codes(card) == []
