"""剧本试玩的检查点：按名字找人和物，逐种判断，出错时写明实际记成了什么。"""

from __future__ import annotations

from typing import Any

import pytest

from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    WorldRecords,
)
from evals.playtest_checks import Check, evaluate, evaluate_all, parse_checks


def entity(id: str, kind: str, name: str, **kw: Any) -> EntityRecord:
    return EntityRecord(id=id, kind=kind, name=name, name_norm=normalize_name(name), **kw)


WORLD = WorldRecords(
    entities=(
        entity("w", "world", "世界", data={"scene": {"location": "inn", "present": ["ling"]}}),
        entity("hero", "character", "林川", is_protagonist=True),
        entity("zhou", "character", "老周", retired=True),
        entity("ling", "character", "阿苓"),
        entity("hood", "character", "兜帽人", aliases=("缺指人",)),
        entity("inn", "location", "灰石镇酒馆"),
        entity("branch", "location", "北境商会分号"),
        entity("map", "item", "阿苓画的路线图"),
        entity("letter", "item", "无收件人的信"),
    ),
    links=(
        LinkRecord("hero", "located_in", "inn"),
        LinkRecord("ling", "located_in", "inn"),
        LinkRecord("hood", "located_in", "branch"),
        LinkRecord("map", "held_by", "hero"),
        LinkRecord("letter", "located_in", "branch"),
    ),
    facts=(FactRecord(id="f1", text="林川把信藏进了货栈的木箱"),),
)


def check(kind: str, *args: str) -> bool:
    return evaluate(Check(10, kind, args), WORLD).passed


def test_each_kind() -> None:
    assert check("retired", "老周") and not check("alive", "老周")
    assert check("alive", "阿苓") and not check("retired", "阿苓")
    assert check("holds", "林川", "图") and check("not_holds", "林川", "信")
    assert check("at", "林川", "酒馆") and check("not_at", "林川", "分号")
    # 物品在谁手里，就看那个人在哪
    assert check("at", "路线图", "酒馆")
    assert check("together", "林川", "阿苓") and check("apart", "林川", "缺指人")
    assert check("present", "阿苓") and check("absent", "兜帽")
    assert check("gone", "老周") and check("gone", "兜帽") and not check("gone", "阿苓")
    assert check("fact", "信", "木箱") and not check("fact", "信", "火")


def test_failures_say_what_was_recorded() -> None:
    missing = evaluate(Check(10, "retired", ("阿福",)), WORLD)
    assert not missing.passed and missing.detail == "找不到“阿福”"
    wrong = evaluate(Check(10, "at", ("林川", "分号")), WORLD)
    assert not wrong.passed and wrong.detail == "“林川”在“灰石镇酒馆”"


def test_unprocessed_turns_fail() -> None:
    [result] = evaluate_all([Check(30, "alive", ("阿苓",))], {10: WORLD}, 10)
    assert not result.passed and "没整理到第 30 回合" in result.detail


def test_parse_checks() -> None:
    raw = [{"after": 70, "expect": [{"retired": "老周"}, {"together": ["林川", "阿苓"]}]}]
    assert parse_checks(raw) == [
        Check(70, "retired", ("老周",)),
        Check(70, "together", ("林川", "阿苓")),
    ]
    with pytest.raises(ValueError, match="unknown check kind"):
        parse_checks([{"after": 1, "expect": [{"dead": "老周"}]}])
    with pytest.raises(ValueError, match="takes 2"):
        parse_checks([{"after": 1, "expect": [{"holds": ["林川"]}]}])
