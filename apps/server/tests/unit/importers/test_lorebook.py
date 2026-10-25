"""导入独立世界书（docs/lorebook.md 第 6 节）：认哪几种格式、每个字段怎么对应、丢掉哪些条目、
导入报告。

样例照 SillyTavern 世界书文件（worlds/*.json）和角色卡规范（character_book、lorebook_v3）
的结构自己写，不拷 ST 的文件。
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from bettertavern.domain.scenario.card import LoreRules
from bettertavern.domain.scenario.lorebook import MAX_LOREBOOK_CHARS, MAX_LOREBOOK_ENTRIES
from bettertavern.importers.lorebook import LorebookError, import_lorebook


def st_entry(uid: int, **fields: Any) -> dict[str, Any]:
    """ST 新建条目时写的样子（newWorldInfoEntryTemplate 的默认值），再按 fields 改几项。"""
    entry: dict[str, Any] = {
        "uid": uid,
        "key": [],
        "keysecondary": [],
        "comment": "",
        "content": "",
        "constant": False,
        "vectorized": False,
        "selective": True,
        "selectiveLogic": 0,
        "addMemo": True,
        "order": 100,
        "position": 0,
        "disable": False,
        "ignoreBudget": False,
        "excludeRecursion": False,
        "preventRecursion": False,
        "matchPersonaDescription": False,
        "matchCharacterDescription": False,
        "matchCharacterPersonality": False,
        "matchCharacterDepthPrompt": False,
        "matchScenario": False,
        "matchCreatorNotes": False,
        "delayUntilRecursion": False,
        "probability": 100,
        "useProbability": True,
        "depth": 4,
        "outletName": "",
        "group": "",
        "groupOverride": False,
        "groupWeight": 100,
        "scanDepth": None,
        "caseSensitive": None,
        "matchWholeWords": None,
        "useGroupScoring": None,
        "automationId": "",
        "role": 0,
        "sticky": 0,
        "cooldown": 0,
        "delay": 0,
        "triggers": [],
        "displayIndex": uid,
    }
    entry.update(fields)
    return entry


def world(*entries: dict[str, Any], **top: Any) -> bytes:
    return json.dumps(
        {"entries": {str(e["uid"]): e for e in entries}, **top}, ensure_ascii=False
    ).encode()


def test_st_world_file_maps_every_field() -> None:
    data = world(
        st_entry(
            0,
            comment="青石渡",
            key=["青石渡", " 渡口 ", "渡口", ""],
            keysecondary=["夜里"],
            selectiveLogic=3,
            content="青石渡是江边小镇，{{char}} 在这里开茶馆。",
            order=250,
            displayIndex=1,
            matchWholeWords=False,
            caseSensitive=True,
            scanDepth=6,
            matchScenario=True,
            matchPersonaDescription=True,
            excludeRecursion=True,
            delayUntilRecursion=True,
            probability=30,
            group="天气, 渡口 ,天气",
            groupOverride=True,
            groupWeight=40,
            useGroupScoring=True,
            sticky=3,
            cooldown=4,
            delay=5,
            triggers=["normal", "swipe", "bogus"],
            ignoreBudget=True,
        ),
        st_entry(1, comment="背景", content="没有法术的架空王朝", constant=True, displayIndex=0),
    )
    book = import_lorebook(data, filename="雨夜渡口.json")
    assert book.source == "st_world" and book.name == "雨夜渡口"
    # 按 displayIndex 排，order 重新编号成列表位置
    assert [e.name for e in book.book] == ["背景", "青石渡"]
    assert [e.order for e in book.book] == [0, 1]
    first, second = book.book
    assert first.constant and first.keys == () and first.rules is None
    assert first.priority == 100
    assert second.keys == ("青石渡", "渡口")
    assert second.secondary_keys == ("夜里",)
    assert second.logic == "all"
    assert second.priority == 250
    assert second.content == "青石渡是江边小镇，{{char}} 在这里开茶馆。"  # 宏原样保存
    assert second.rules == LoreRules(
        whole_words=False,
        case_sensitive=True,
        scan_depth=6,
        match=("persona", "scenario"),
        exclude_recursion=True,
        delay_until_recursion=1,
        probability=30,
        groups=("天气", "渡口"),
        group_override=True,
        group_weight=40,
        group_scoring=True,
        sticky=2,  # 3 条消息 → 2 回合
        cooldown=2,
        delay=3,
        triggers=("normal", "swipe"),
        ignore_budget=True,
    )
    assert book.report.entries == 2 and book.report.constant == 1


def test_selective_logic_and_probability_switches() -> None:
    data = world(
        st_entry(0, key=["甲"], keysecondary=["乙"], selectiveLogic=1, content="不全命中"),
        st_entry(1, key=["甲"], keysecondary=["乙"], selectiveLogic=2, content="一个都不命中"),
        # selective 为假时 ST 不看次要关键词
        st_entry(2, key=["甲"], keysecondary=["乙"], selective=False, content="不看次要"),
        # useProbability 为假时概率不起作用
        st_entry(3, key=["甲"], probability=10, useProbability=False, content="必定触发"),
    )
    entries = import_lorebook(data).book
    assert [e.logic for e in entries[:2]] == ["not_all", "not_any"]
    assert entries[2].secondary_keys == ()
    assert entries[3].rules is None


def test_drops_empty_and_unreachable_entries_and_reports_them() -> None:
    data = world(
        st_entry(0, key=["甲"], content="   "),
        st_entry(1, key=[], content="没有关键词也不常驻"),
        st_entry(2, key=["乙"], content="停用的也留着", disable=True),
        st_entry(3, key=["丙"], content="按意思匹配", vectorized=True),
        st_entry(
            4, key=["丁"], content="只给某角色", characterFilter={"names": ["a.png"], "tags": []}
        ),
        st_entry(5, key=["/(老周|周叔/i"], content="正则写坏了"),
        st_entry(6, key=["/老周|周叔/i"], content="好的正则"),
        st_entry(7, key=["戊"], content="今天是{{time}}，{{user}}来了"),
    )
    book = import_lorebook(data)
    report = book.report
    assert report.entries == 6
    assert report.dropped_empty == 1 and report.dropped_unreachable == 1
    assert report.disabled == 1 and not book.book[0].enabled
    assert (report.vectorized, report.character_filter) == (1, 1)
    assert report.bad_regex == 1
    assert report.other_macros == 1


def test_decorators_become_constant_or_disabled() -> None:
    data = world(
        st_entry(0, key=["甲"], content="@@activate\n常驻的内容"),
        st_entry(1, key=["乙"], content="@@dont_activate\n@@unknown\n只能靠脚本触发"),
        # @@@ 是备选：跟在不认得的装饰后面才算，单独写着不算
        st_entry(2, key=["丙"], content="@@future\n@@@activate\n备选生效"),
        st_entry(3, key=["丁"], content="@@@activate\n备选不生效"),
    )
    first, second, third, fourth = import_lorebook(data).book
    assert first.constant and first.content == "常驻的内容"
    assert not second.enabled and second.content == "只能靠脚本触发"
    assert third.constant and third.content == "备选生效"
    assert not fourth.constant and fourth.content == "备选不生效"


def book_entry(**fields: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {"keys": ["老周"], "content": "老周是船夫", "enabled": True}
    entry.update(fields)
    return entry


def test_lorebook_v3_with_st_extensions() -> None:
    data = {
        "spec": "lorebook_v3",
        "data": {
            "name": "青石渡设定",
            "description": "渡口和镇上的人",
            "entries": [
                book_entry(
                    name="老周",
                    insertion_order=7,
                    secondary_keys=["欠债"],
                    selective=True,
                    extensions={
                        "display_index": 2,
                        "selectiveLogic": 2,
                        "sticky": 2,
                        "group": "人物",
                        "probability": 50,
                        "useProbability": True,
                        "match_whole_words": True,
                        "prevent_recursion": True,
                    },
                ),
                book_entry(
                    comment="商会",
                    keys=["北境商会"],
                    insertion_order=3,
                    enabled=False,
                    extensions={"display_index": 0},
                ),
                # 没写 selective：ST 当作不看次要关键词
                book_entry(secondary_keys=["欠债"], extensions={"display_index": 1}),
            ],
        },
    }
    book = import_lorebook(json.dumps(data, ensure_ascii=False).encode(), filename="x.json")
    assert book.source == "lorebook"
    assert (book.name, book.description) == ("青石渡设定", "渡口和镇上的人")
    shang, plain, zhou = book.book
    assert shang.name == "商会" and not shang.enabled and shang.priority == 3
    assert plain.secondary_keys == () and plain.priority == 100
    assert zhou.secondary_keys == ("欠债",) and zhou.logic == "not_any" and zhou.priority == 7
    assert zhou.rules == LoreRules(
        whole_words=True, prevent_recursion=True, probability=50, groups=("人物",), sticky=1
    )


def test_bare_character_book_and_st_world_name_fallbacks() -> None:
    bare = {"name": "裸的世界书", "entries": [book_entry()]}
    book = import_lorebook(json.dumps(bare, ensure_ascii=False).encode())
    assert book.source == "lorebook" and book.name == "裸的世界书"
    from_card = world(st_entry(0, key=["甲"], content="内容"), originalData={"name": "卡里的书"})
    assert import_lorebook(from_card, filename="文件名.json").name == "卡里的书"
    assert import_lorebook(world(st_entry(0, key=["甲"], content="内容"))).name == "Lorebook"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (b"{not json", "invalid"),
        (b"[1, 2]", "invalid"),
        (b'{"entries": {}}', "invalid"),
        (b'{"name": "no entries"}', "invalid"),
        (
            json.dumps({"spec": "chara_card_v2", "data": {"name": "阿苓"}}).encode(),
            "is_card",
        ),
        (json.dumps({"name": "阿苓", "first_mes": "你好"}).encode(), "is_card"),
    ],
)
def test_rejects_what_is_not_a_lorebook(payload: bytes, code: str) -> None:
    with pytest.raises(LorebookError) as caught:
        import_lorebook(payload)
    assert caught.value.code == code


def test_keeps_at_most_the_entry_limit_in_display_order() -> None:
    count = MAX_LOREBOOK_ENTRIES + 5
    data = world(
        *(st_entry(i, key=["k"], content="x", displayIndex=count - i) for i in range(count))
    )
    book = import_lorebook(data)
    assert len(book.book) == MAX_LOREBOOK_ENTRIES
    assert book.report.dropped_over_limit == 5
    # displayIndex 小的在前：uid 最大的几条排在最前面，被丢掉的是 uid 最小的几条
    assert book.book[0].order == 0 and book.book[-1].order == MAX_LOREBOOK_ENTRIES - 1


def test_rejects_books_with_too_much_text() -> None:
    size = 50_000
    n = MAX_LOREBOOK_CHARS // size + 1
    data = world(*(st_entry(i, key=["k"], content="字" * size) for i in range(n)))
    with pytest.raises(LorebookError):
        import_lorebook(data)
