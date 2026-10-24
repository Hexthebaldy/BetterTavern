"""闪电模式的压缩请求：开头和导演下一回合的请求一字不差（前缀缓存），最后一条是整理要求。"""

from __future__ import annotations

from dataclasses import replace

from bettertavern.domain.story.turn import PlayerAction
from bettertavern.runtime.agents.compressor import compress_messages, parse_synopsis
from bettertavern.runtime.context.assembler import ContextAssembler
from bettertavern.runtime.ports import StoryMemory, TurnContext
from bettertavern.runtime.prompts import PromptLibrary
from tests.unit.runtime.test_context import context


def lightning(ctx: TurnContext) -> TurnContext:
    return replace(ctx, header=replace(ctx.header, mode="lightning"))


def test_the_request_starts_like_the_directors_last_request() -> None:
    for language in ("zh", "en", "ja"):
        prompts = PromptLibrary(language)
        # 导演上一回合（第 3 回合）的请求：原文到第 2 回合，最后是第 3 回合的行动
        last_turn = ContextAssembler(prompts).assemble(
            lightning(context(history=3, action="行动3")), 64_000
        )
        # 压缩时原文到第 3 回合（头部）
        messages, _ = compress_messages(lightning(context(history=4)), 1, prompts, 64_000)
        assert messages[: len(last_turn.messages)] == last_turn.messages
        assert len(messages) == len(last_turn.messages) + 2  # 第 3 回合的回复，加上整理要求
        assert (
            "<synopsis>" in messages[-1].content and "<player-action>" not in messages[-1].content
        )


def test_the_request_names_the_range_and_mentions_the_old_synopsis() -> None:
    prompts = PromptLibrary("zh")
    fresh, _ = compress_messages(lightning(context(history=4)), 2, prompts, 64_000)
    assert "第 0 回合到第 2 回合的原文" in fresh[-1].content
    assert "全书梗概和" not in fresh[-1].content
    with_synopsis = replace(
        lightning(context(history=4)), memory=StoryMemory(synopsis="之前的事", summarized_seq=-1)
    )
    later, _ = compress_messages(with_synopsis, 2, prompts, 64_000)
    assert "<recap> 里的全书梗概和" in later[-1].content
    assert "之前的事" in later[0].content  # 旧梗概在回顾里（system 的末尾）
    assert "<world-state>" not in later[0].content


def test_the_synopsis_is_read_from_its_tags() -> None:
    assert parse_synopsis("好的。\n<synopsis>\n林川到了渡口。\n</synopsis>") == (
        "林川到了渡口。",
        False,
    )
    assert parse_synopsis("<synopsis>\n写到一半") == ("写到一半", True)
    assert parse_synopsis("  没有标签的梗概 ") == ("没有标签的梗概", False)
    assert parse_synopsis("<synopsis></synopsis>") == ("", False)
    assert len(parse_synopsis("<synopsis>" + "字" * 3000 + "</synopsis>")[0]) == 1800


def test_the_action_never_leaks_into_the_request() -> None:
    prompts = PromptLibrary("zh")
    ctx = replace(lightning(context(history=4)), action=PlayerAction("text", "不该出现的行动"))
    messages, _ = compress_messages(ctx, 1, prompts, 64_000)
    assert all("不该出现的行动" not in m.content for m in messages)
