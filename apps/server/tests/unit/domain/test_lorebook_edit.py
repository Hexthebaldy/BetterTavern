"""编辑独立世界书的条目（docs/lorebook.md 第 5 节）：和草稿一样宽松，超过上限拒绝。"""

from __future__ import annotations

import pytest

from bettertavern.domain.scenario.card import LoreEntry
from bettertavern.domain.scenario.edit import EditError, LoreEntryEdit
from bettertavern.domain.scenario.lorebook import (
    MAX_LOREBOOK_CHARS,
    MAX_LOREBOOK_ENTRIES,
    edit_book,
    has_other_macros,
    never_triggers,
    regex_key,
)


def test_unfinished_entries_are_allowed() -> None:
    book = edit_book((LoreEntryEdit(name="还没写"), LoreEntryEdit(keys=("甲",), content=" 内容 ")))
    assert [(e.name, e.content, e.order) for e in book] == [("还没写", "", 0), ("", "内容", 1)]
    assert never_triggers(book[0]) and not never_triggers(book[1])


def test_limits() -> None:
    with pytest.raises(EditError) as info:
        edit_book(tuple(LoreEntryEdit() for _ in range(MAX_LOREBOOK_ENTRIES + 1)))
    assert info.value.field == "book"
    size = 60_000
    big = tuple(LoreEntryEdit(content="字" * size) for _ in range(MAX_LOREBOOK_CHARS // size + 1))
    with pytest.raises(EditError) as info:
        edit_book(big)
    assert info.value.field == "book"


def test_never_triggers() -> None:
    assert never_triggers(LoreEntry(content="没关键词也不常驻"))
    assert not never_triggers(LoreEntry(content="常驻", constant=True))
    assert never_triggers(LoreEntry(keys=("甲",), content="  "))


def test_regex_keys_follow_sillytavern() -> None:
    parsed = regex_key("/老周|周叔/is")
    assert parsed is not None and parsed.pattern == "老周|周叔"
    assert parsed.ignore_case and parsed.dotall and not parsed.multiline
    assert regex_key("老周") is None
    assert regex_key("/a/b/") is None  # 中间有没转义的斜杠
    assert regex_key(r"/a\/b/") is not None
    assert regex_key("/abc/x") is None  # 不认的开关


def test_other_macros() -> None:
    assert not has_other_macros("{{user}} 和 {{ char }}")
    assert has_other_macros("今天是 {{time}}")
