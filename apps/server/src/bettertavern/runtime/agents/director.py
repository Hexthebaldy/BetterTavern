"""导演（Director）：每轮同步调用，流式产出叙述加 2 个选项（带分隔标签的纯文本），
选项之后可以有一段玩家看不到的 <director-notes>。

这里只负责 agent 的定义和把消息变成请求；召回工具在同级文件 director_tools.py，执行循环在
runtime/director_loop.py，流式解析在 runtime/turn_stream.py，
修复阶梯和提交由 runtime/runner.py 编排。
"""

from __future__ import annotations

from collections.abc import Sequence

from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ChatRequest, Message, ToolSpec
from bettertavern.runtime.agent import AgentSpec, OutputKind
from bettertavern.runtime.routing import ResolvedRoute

from .director_tools import TOOL_NAMES

AGENT = "director"
# 最多带工具请求两次：每用一轮工具，整段上下文就要重新发给模型一次，玩家多等一次
MAX_TOOL_ROUNDS = 2

SPEC = AgentSpec(
    name=AGENT,
    task=RouteTask.DIRECTOR,
    output=OutputKind.TAGGED_STREAM,
    tools=TOOL_NAMES,
    max_tool_rounds=MAX_TOOL_ROUNDS,
)


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
