"""导演的召回：什么时候提供工具、先查再写的事件顺序、最多两轮、叙述开始后不再查、
玩家看不到查东西那一轮的字，以及多轮合起来的用量和首字时间。"""

from __future__ import annotations

import json
from dataclasses import replace

import pytest

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.providers import CancelToken, Capabilities, ProviderHub, ToolCall
from bettertavern.runtime.events.buffer import EventStream
from bettertavern.runtime.ports import ChapterSummary, HistoryTurn, PastTurn, StoryMemory
from bettertavern.runtime.prompts import PromptBook
from bettertavern.runtime.runner import RunnerConfig, TurnRunner
from tests.fakes.runtime import (
    FakeRecall,
    FakeRoutes,
    FakeStore,
    StreamScript,
    header,
    make_route,
    scripted_hub,
)

pytestmark = pytest.mark.anyio

GOOD = (
    "<narrative>\n老周想了想：那火漆上压着一只乌鸦。\n</narrative>\n"
    "<options>\n1. 追问乌鸦\n2. 告辞\n</options>"
)
CONFIG = RunnerConfig(delta_batch_s=0.0, lease_renew_s=10)
# 第 0 到 11 回合已经写成章节摘要：原文从第 10 回合开始（多留上一章最后两回合）
MEMORY = StoryMemory(
    chapters=(ChapterSummary(0, 11, "林川在灰石镇打听火漆，老周说上面压着乌鸦。"),),
    summarized_seq=11,
)


def history(count: int) -> list[HistoryTurn]:
    return [
        HistoryTurn(seq=i, action=PlayerAction("text", f"行动{i}"), narrative=f"叙述{i}")
        for i in range(count)
    ]


def recall_store() -> FakeRecall:
    return FakeRecall(
        turns=[
            PastTurn(
                seq=1,
                action=PlayerAction("text", "我问老周认不认识信封上的火漆"),
                narrative="老周盯着火漆看了很久，上面压着一只衔着钥匙的乌鸦。",
                digest="林川向老周打听火漆",
            )
        ]
    )


def recall_call(arguments: dict[str, object], call_id: str = "call-1") -> ToolCall:
    return ToolCall(id=call_id, name="recall", arguments=json.dumps(arguments, ensure_ascii=False))


async def play(
    hub: ProviderHub,
    *,
    seq: int = 25,
    caps: Capabilities | None = None,
    recall: FakeRecall | None = None,
    memory: StoryMemory = MEMORY,
) -> tuple[FakeStore, list[tuple[str, dict[str, object]]]]:
    start = 0 if memory.summarized_seq < 0 else memory.summarized_seq - 1
    store = FakeStore(history=history(seq)[start:], state_seq=seq - 1, memory=memory)
    runner = TurnRunner(
        store=store,
        routes=FakeRoutes({RouteTask.DIRECTOR: make_route(caps=caps)}),
        hub=hub,
        prompts=PromptBook(),
        config=CONFIG,
        recall=recall if recall is not None else recall_store(),
    )
    stream = EventStream("turn-1")
    await runner.run(header(seq), stream, CancelToken())
    return store, [(e.event, json.loads(e.data)) for e in stream.snapshot()]


async def test_director_looks_up_an_old_turn_then_writes() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript(["让我查一下。"], tool_calls=[recall_call({"query": "火漆"})]))
    fake.streams.append(StreamScript([GOOD]))
    store, events = await play(hub)
    names = [e for e, _ in events]
    # 先推“正在回想”，再推叙述；查东西那一轮的字和 narrative.done 都不推给玩家
    assert names.index("director.recalling") < names.index("narrative.delta")
    assert names.count("narrative.done") == 1
    deltas = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    assert "让我查一下" not in deltas and deltas.startswith("老周想了想")
    first, second = fake.requests
    assert first.tools is not None and [t.name for t in first.tools] == [
        "recall",
        "read_turn",
        "lookup",
    ]
    # 第二次请求：模型的工具调用和工具结果接在后面，结果用 <recall> 包着
    *_, call_message, tool_message = second.messages
    assert call_message.role == "assistant" and call_message.tool_calls[0].name == "recall"
    assert tool_message.role == "tool" and tool_message.tool_call_id == "call-1"
    assert tool_message.content.startswith("<recall>") and "乌鸦" in tool_message.content
    outcome = store.committed[0]
    assert outcome.narrative.startswith("老周想了想")
    run = outcome.runs[0]
    assert run.result["tool_rounds"] == 1 and run.result["recall_before"] == 10
    assert [s.kind for s in run.steps] == ["model", "tool", "model"]
    # 两轮的用量相加
    assert run.usage is not None and run.usage.prompt == 200


async def test_final_message_tells_where_the_story_text_starts() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript([GOOD]))
    await play(hub)
    [request] = adapters["fake"].requests
    last = request.messages[-1].content
    assert "现在是第 25 回合" in last and "从第 10 回合开始" in last
    # 第 10 回合之前的原文不在上下文里
    texts = [m.content for m in request.messages]
    assert not any("叙述9\n" in t for t in texts) and any("叙述10\n" in t for t in texts)
    # 更早的回合在 system 末尾的回顾里
    system = request.messages[0].content
    assert system.index("<recap>") > system.index("## 输出格式")
    assert "### 第 0–11 回合\n林川在灰石镇打听火漆" in system


async def test_no_tools_while_the_whole_story_is_in_context() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript([GOOD]))
    store, events = await play(hub, seq=12, memory=StoryMemory())
    [request] = adapters["fake"].requests
    assert request.tools is None
    assert "director.recalling" not in [e for e, _ in events]
    assert store.committed[0].runs[0].result["recall_before"] == 0


async def test_lightning_offers_the_same_tools_once_old_turns_are_compressed() -> None:
    """闪电模式和普通模式一样：原文之前有压成梗概的回合时，给导演召回工具"""
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript([GOOD]))
    memory = StoryMemory(synopsis="林川在灰石镇打听火漆。", summarized_seq=9)
    store = FakeStore(history=history(25)[10:], memory=memory)
    runner = TurnRunner(
        store=store,
        routes=FakeRoutes({RouteTask.DIRECTOR: make_route()}),
        hub=hub,
        prompts=PromptBook(),
        config=CONFIG,
        recall=recall_store(),
    )
    await runner.run(replace(header(25), mode="lightning"), EventStream("turn-1"), CancelToken())
    [request] = adapters["fake"].requests
    assert request.tools is not None
    assert [t.name for t in request.tools] == ["recall", "read_turn", "lookup"]
    assert "从第 10 回合开始" in request.messages[-1].content
    assert store.committed[0].runs[0].result["recall_before"] == 10


async def test_no_tools_for_models_that_cannot_call_them() -> None:
    hub, adapters = scripted_hub("fake")
    adapters["fake"].streams.append(StreamScript([GOOD]))
    await play(hub, caps=Capabilities(context_window=65536, tools=False))
    [request] = adapters["fake"].requests
    assert request.tools is None
    # 没有工具时也不提示可以查
    assert "可以用工具查" not in request.messages[-1].content


async def test_at_most_two_tool_rounds_then_the_director_must_write() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript([], tool_calls=[recall_call({"query": "火漆"}, "c1")]))
    fake.streams.append(StreamScript([], tool_calls=[recall_call({"entity": "老周"}, "c2")]))
    fake.streams.append(StreamScript([GOOD]))
    store, events = await play(hub)
    assert [r.tools is not None for r in fake.requests] == [True, True, False]
    assert [d["round"] for e, d in events if e == "director.recalling"] == [1, 2]
    assert store.committed[0].runs[0].result["tool_rounds"] == 2


async def test_tool_calls_after_the_narrative_started_are_ignored() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    fake.streams.append(StreamScript([GOOD], tool_calls=[recall_call({"query": "火漆"})]))
    store, events = await play(hub)
    assert len(fake.requests) == 1
    assert "director.recalling" not in [e for e, _ in events]
    assert store.committed[0].narrative.startswith("老周想了想")
    assert store.committed[0].runs[0].result["tool_rounds"] == 0


async def test_director_notes_are_saved_but_never_streamed() -> None:
    hub, adapters = scripted_hub("fake")
    notes = "<director-notes>\n伏笔：乌鸦是商会的暗记。\n</director-notes>"
    adapters["fake"].streams.append(StreamScript([GOOD + "\n" + notes]))
    store, events = await play(hub, seq=3, memory=StoryMemory())
    deltas = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    assert "伏笔" not in deltas
    completed = events[-1][1]["turn"]
    assert isinstance(completed, dict) and "伏笔" not in json.dumps(completed, ensure_ascii=False)
    assert store.committed[0].director_notes == "伏笔：乌鸦是商会的暗记。"


async def test_a_tool_call_written_as_text_is_retried_without_tools() -> None:
    hub, adapters = scripted_hub("fake")
    fake = adapters["fake"]
    junk = "<recall>\n<query>火漆</query>\n</recall>\n</｜｜DSML｜｜ invoke>"
    fake.streams.append(StreamScript([junk]))
    fake.streams.append(StreamScript([GOOD]))
    store, events = await play(hub)
    first, second = fake.requests
    assert first.tools is not None and second.tools is None
    assert second.messages == first.messages  # 同样的消息，前缀缓存照样命中
    deltas = "".join(str(d["text"]) for e, d in events if e == "narrative.delta")
    assert deltas.startswith("老周想了想") and "recall" not in deltas
    assert [e for e, _ in events].count("narrative.done") == 1
    outcome = store.committed[0]
    assert outcome.narrative.startswith("老周想了想")
    assert [s.kind for s in outcome.runs[0].steps] == ["model", "model"]
    assert outcome.runs[0].usage is not None and outcome.runs[0].usage.prompt == 200
