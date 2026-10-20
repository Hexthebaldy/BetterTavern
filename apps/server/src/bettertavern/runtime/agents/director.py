"""导演（Director）：每轮同步调用，流式产出叙述加 2 个选项（带分隔标签的纯文本）。

这里只负责 agent 的定义和把消息变成请求；流式解析在 runtime/turn_stream.py，修复阶梯和提交由
runtime/runner.py 编排。召回工具在 agent runtime 阶段 3 加入（docs/agent-runtime.md 第 7 节）。
"""

from __future__ import annotations

from collections.abc import Sequence

from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ChatRequest, Message, ToolSpec
from bettertavern.runtime.agent import AgentSpec, OutputKind
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "director"

SPEC = AgentSpec(name=AGENT, task=RouteTask.DIRECTOR, output=OutputKind.TAGGED_STREAM)


def director_request(
    messages: Sequence[Message], route: ResolvedRoute, tools: Sequence[ToolSpec] | None = None
) -> ChatRequest:
    return ChatRequest(
        messages=list(messages),
        model=route.model,
        max_tokens=route.max_tokens,
        temperature=route.temperature,
        top_p=route.params.top_p,
        reasoning=route.reasoning(),
        tools=list(tools) if tools else None,
    )
