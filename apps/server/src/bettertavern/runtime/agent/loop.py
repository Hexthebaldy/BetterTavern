"""执行循环（docs/agent-runtime.md 第 5 节“执行循环”）。

一轮 = 调一次模型。模型要用工具，就执行工具，把它的这条回复和每个工具结果接到消息后面，
再调下一轮；不用工具（或者已经给出最终输出）就结束。最多带工具请求 `spec.max_tool_rounds` 次，
下一次请求不再提供工具，模型只能给出最终输出。

“调一次模型”由调用方传进来（`ModelCall`）：导演是一边收一边推给玩家的流式调用，开局构建和补选项是
结构化输出。它们各自把模型调用记进 `StepLog`（只有它们知道细节：第几次尝试、用了哪种输出方式），
循环只记工具这一步。
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.providers import Message, ToolCall, ToolSpec
from bettertavern.runtime.prompts import PromptLibrary

from .spec import AgentSpec
from .steps import StepLog
from .tools import ToolRegistry

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class ModelReply[T]:
    value: T  # 这一轮的最终输出（导演是解析好的叙述和选项）
    text: str = ""  # 模型这一轮写出的原文；带工具调用时会作为 assistant 消息接回去
    tool_calls: tuple[ToolCall, ...] = ()
    # 这一轮的输出已经定下来（例如导演的叙述已经开始推给玩家），之后的工具调用一律忽略
    closed: bool = False


ModelCall = Callable[[Sequence[Message], Sequence[ToolSpec] | None], Awaitable[ModelReply[Any]]]


async def run_agent[T](
    spec: AgentSpec,
    messages: Sequence[Message],
    call: Callable[[Sequence[Message], Sequence[ToolSpec] | None], Awaitable[ModelReply[T]]],
    *,
    steps: StepLog,
    prompts: PromptLibrary,
    registry: ToolRegistry | None = None,
    ctx: Any = None,
    clock: Callable[[], float] = time.monotonic,
) -> T:
    history = list(messages)
    for round_no in range(spec.max_tool_rounds + 1):
        offer_tools = registry is not None and round_no < spec.max_tool_rounds
        tools = registry.specs(spec, prompts) if registry is not None and offer_tools else None
        reply = await call(history, tools)
        if not reply.tool_calls:
            return reply.value
        if tools is None or reply.closed:
            # 没提供工具却来了工具调用，或者输出已经定下来：不执行
            log.warning(
                "agent.tool_calls_ignored",
                agent=spec.name,
                round=round_no,
                tools=[c.name for c in reply.tool_calls],
                closed=reply.closed,
            )
            return reply.value
        assert registry is not None
        history.append(Message(role="assistant", content=reply.text, tool_calls=reply.tool_calls))
        for tool_call in reply.tool_calls:
            started = clock()
            outcome = await registry.call(spec, tool_call, ctx, prompts)
            latency_ms = int((clock() - started) * 1000)
            steps.tool(
                tool_call.name,
                args=dict(outcome.args)
                if outcome.args is not None
                else {"raw": tool_call.arguments},
                result={"text": outcome.text, "error": outcome.error},
                latency_ms=latency_ms,
            )
            log.info(
                "agent.tool",
                agent=spec.name,
                tool=tool_call.name,
                error=outcome.error,
                result_chars=len(outcome.text),
                duration_ms=latency_ms,
            )
            history.append(Message(role="tool", content=outcome.text, tool_call_id=tool_call.id))
    raise AssertionError("the last round never offers tools, so it always returns")
