"""导演的三个召回工具：按名字、按关键词找旧回合，读某一回合，查实体的完整资料；
只查不在上下文里的回合，一回合的返回有总量上限。"""

from __future__ import annotations

import json
from typing import Any

import pytest

from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.records import (
    EntityRecord,
    FactRecord,
    LinkRecord,
    WorldRecords,
)
from bettertavern.providers import ToolCall
from bettertavern.runtime.agents.director import SPEC
from bettertavern.runtime.agents.director_tools import (
    REGISTRY,
    TURN_BUDGET_CHARS,
    RecallContext,
    excerpt,
)
from bettertavern.runtime.ports import PastTurn
from bettertavern.runtime.prompts import PromptLibrary
from tests.fakes.runtime import FakeRecall

pytestmark = pytest.mark.anyio

PROMPTS = PromptLibrary("zh")


def entity(id_: str, kind: str, name: str, **kw: Any) -> EntityRecord:
    return EntityRecord(id=id_, kind=kind, name=name, name_norm=name, **kw)


WORLD = WorldRecords(
    entities=(
        entity("w", "world", "世界"),
        entity("hero", "character", "林川", is_protagonist=True),
        entity("zhou", "character", "老周", summary="酒馆掌柜", retired=True),
        entity("hood", "character", "兜帽客", aliases=("缺指的人",), data={"goal": "等人"}),
        entity("seal", "item", "火漆"),
        entity("tavern", "location", "酒馆"),
    ),
    links=(
        LinkRecord("hood", "located_in", "tavern"),
        LinkRecord("seal", "held_by", "hood"),
    ),
    facts=(
        FactRecord(id="f1", text="兜帽客在等北境商会的人", entity_ids=("hood",), created_seq=3),
        FactRecord(
            id="f2",
            text="兜帽客是商会派来的",
            entity_ids=("hood",),
            visibility="secret",
            known_by=("zhou",),
            created_seq=5,
        ),
    ),
)

TURNS = [
    PastTurn(1, PlayerAction("text", "我问老周认不认识火漆"), "老周说火漆上是乌鸦。", "打听火漆"),
    PastTurn(2, PlayerAction("text", "我坐下"), "角落里坐着戴兜帽的人，左手缺了一根手指。", ""),
    PastTurn(4, PlayerAction("text", "我去码头"), "码头的火漆和乌鸦旗子都湿透了。", "去码头"),
    PastTurn(12, PlayerAction("text", "我回酒馆"), "火漆还在柜台上。", "回酒馆"),
]


def context(**kw: Any) -> RecallContext:
    store = FakeRecall(records=WORLD, turns=TURNS, notes={2: ("hood",), 4: ("seal",)})
    defaults: dict[str, Any] = {
        "store": store,
        "playthrough_id": "pt",
        "seq": 20,
        "before_seq": 10,
        "messages": PROMPTS.data("recall"),
    }
    return RecallContext(**(defaults | kw))


async def call(ctx: RecallContext, tool: str, /, **args: Any) -> tuple[Any, str | None]:
    arguments = json.dumps(args, ensure_ascii=False)
    outcome = await REGISTRY.call(
        SPEC, ToolCall(id="c", name=tool, arguments=arguments), ctx, PROMPTS
    )
    if outcome.error is not None:
        return None, outcome.text
    body = outcome.text.removeprefix("<recall>\n").removesuffix("\n</recall>")
    return json.loads(body), None


async def test_recall_by_name_uses_turn_tags_and_aliases() -> None:
    result, error = await call(context(), "recall", entity="缺指的人")
    assert error is None
    assert result["entity"] == "兜帽客"
    assert [t["turn"] for t in result["turns"]] == [2]
    assert "兜帽" in result["turns"][0]["excerpt"]


async def test_recall_by_keywords_ranks_by_how_many_words_match() -> None:
    result, _ = await call(context(), "recall", query="火漆 乌鸦 码头")
    # 第 12 回合在上下文里，不返回；第 4 回合三个词都中，排在第 1 回合前面
    assert [t["turn"] for t in result["turns"]] == [4, 1]
    first = result["turns"][0]
    assert first["digest"] == "去码头" and first["action"] == "我去码头"


async def test_unknown_name_falls_back_to_searching_the_text() -> None:
    result, _ = await call(context(), "recall", entity="乌鸦")
    assert "entity" not in result
    assert [t["turn"] for t in result["turns"]] == [4, 1]


async def test_recall_needs_a_query_or_a_name() -> None:
    _, error = await call(context(), "recall")
    assert error is not None and "query 和 entity 要填一个" in error


async def test_read_turn_only_reads_turns_outside_the_context() -> None:
    result, _ = await call(context(), "read_turn", seq=2)
    assert result == {
        "turn": 2,
        "action": "我坐下",
        "narrative": "角落里坐着戴兜帽的人，左手缺了一根手指。",
    }
    _, in_context = await call(context(), "read_turn", seq=12)
    assert in_context is not None and "就在上面" in in_context
    _, future = await call(context(), "read_turn", seq=20)
    assert future is not None and "没有第 20 回合" in future


async def test_lookup_gives_the_full_record_with_secrets_marked() -> None:
    result, _ = await call(context(), "lookup", name="兜帽客")
    assert result["details"] == {"goal": "等人"}
    assert result["located_in"] == "酒馆" and result["holds"] == ["火漆"]
    secret, public = result["facts"]
    assert secret == {
        "text": "兜帽客是商会派来的",
        "since": 5,
        "secret": True,
        "known_by": ["老周"],
    }
    assert "secret" not in public


async def test_lookup_finds_retired_entities() -> None:
    result, _ = await call(context(), "lookup", name="老周")
    assert result["retired"] is True and result["summary"] == "酒馆掌柜"
    _, error = await call(context(), "lookup", name="阿苓")
    assert error is not None and "阿苓" in error


async def test_results_stop_once_the_turn_budget_is_used_up() -> None:
    ctx = context(used_chars=TURN_BUDGET_CHARS)
    _, error = await call(ctx, "lookup", name="兜帽客")
    assert error is not None and "直接写" in error


def test_excerpt_keeps_about_a_hundred_characters_around_the_match() -> None:
    text = "甲" * 300 + "火漆" + "乙" * 300
    clip = excerpt(text, ["火漆"])
    assert clip.startswith("…") and clip.endswith("…")
    assert len(clip) == 2 + 100 + 2 + 100
    assert excerpt("开头就是正文", ["没有"]) == "开头就是正文"


async def test_names_missing_from_turn_tags_are_searched_in_the_text() -> None:
    # 老周在世界状态里，但回合标签里没记他：退回按名字在原文里找
    result, _ = await call(context(), "recall", entity="老周")
    assert result["entity"] == "老周"
    assert [t["turn"] for t in result["turns"]] == [1]
