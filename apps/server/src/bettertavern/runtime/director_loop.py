"""导演的执行循环（TurnRunner 用，docs/agent-runtime.md 第 5 节“执行循环”）：每一轮是一次流式调用，
模型要用召回工具就执行、把结果接回去再调下一轮，最多两轮工具，第三次请求不再提供工具。

- 只有给了 RecallContext（这一回合有不在上下文里的旧回合、模型能调用工具、不是开场）才提供工具；
- 模型第一次调用工具时推 director.recalling，客户端显示“正在回想……”；
- 叙述一旦开始推给玩家，这一轮的输出就定下来了，之后的工具调用一律忽略；
- 模型把工具调用写成了文字、没写叙述时（解析器认得出来，什么都没推给玩家），
  用同样的消息不带工具马上再请求一次，让它直接写；
- 多轮的结果合成一个 Generation：用量相加；首字时间从第一次请求算到最后一轮的第一个字，
  是玩家实际等的时间。
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from bettertavern.providers import CancelToken, Message, ToolSpec, Usage

from .agent import ModelReply, StepLog, run_agent
from .agents.director import SPEC
from .agents.director_tools import REGISTRY, RecallContext
from .context.assembler import AssembledContext
from .prompts import PromptLibrary
from .protocol.director_parser import TOOL_CALL_AS_TEXT
from .routing import ResolvedRoute
from .turn_stream import DirectorStreamer, Generation, Publish


@dataclass
class _Round:
    generation: Generation
    offset_s: float  # 这一轮从第一次请求开始后多久开流


def _sum_usage(usages: Sequence[Usage | None]) -> Usage | None:
    present = [u for u in usages if u is not None]
    if not present:
        return None
    return Usage(
        prompt=sum(u.prompt for u in present),
        completion=sum(u.completion for u in present),
        cached=sum(u.cached for u in present),
        reasoning=sum(u.reasoning for u in present),
    )


async def run_director(
    streamer: DirectorStreamer,
    route: ResolvedRoute,
    context: AssembledContext,
    publish: Publish,
    cancel: CancelToken,
    *,
    steps: StepLog,
    prompts: PromptLibrary,
    recall: RecallContext | None,
    clock: Callable[[], float] = time.monotonic,
) -> Generation:
    started = clock()
    rounds: list[_Round] = []

    async def recalling() -> None:
        await publish("director.recalling", {"round": len(rounds) + 1})

    async def call(
        messages: Sequence[Message], tools: Sequence[ToolSpec] | None
    ) -> ModelReply[Generation]:
        offset = clock() - started
        generation = await streamer.stream(
            route,
            context,
            publish,
            cancel,
            steps=steps,
            messages=messages,
            tools=tools,
            on_tool_call=recalling,
        )
        if tools and TOOL_CALL_AS_TEXT in generation.parse.repairs and not generation.streamed:
            rounds.append(_Round(generation, offset))
            offset = clock() - started
            generation = await streamer.stream(
                route, context, publish, cancel, steps=steps, messages=messages, tools=None
            )
        rounds.append(_Round(generation, offset))
        return ModelReply(
            value=generation,
            text=generation.raw,
            tool_calls=generation.tool_calls,
            # 叙述一旦推给了玩家，这一轮的输出就定下来了
            closed=bool(generation.streamed),
            reasoning=generation.reasoning if route.caps.echo_reasoning_with_tools else "",
        )

    final = await run_agent(
        SPEC,
        context.messages,
        call,
        steps=steps,
        prompts=prompts,
        registry=REGISTRY if recall is not None else None,
        ctx=recall,
        clock=clock,
    )
    last = rounds[-1]
    ttft_ms = final.ttft_ms
    if ttft_ms is not None:
        ttft_ms += int(last.offset_s * 1000)
    return replace(
        final,
        usage=_sum_usage([r.generation.usage for r in rounds]),
        ttft_ms=ttft_ms,
        latency_ms=int((clock() - started) * 1000),
        tool_rounds=sum(1 for r in rounds if r.generation.tool_calls),
    )
