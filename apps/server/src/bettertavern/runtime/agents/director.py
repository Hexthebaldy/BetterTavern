"""导演（Director）：每轮同步调用，流式产出叙述加 2 个选项（带分隔标签的纯文本）。

这里只负责把装配好的上下文变成请求；流式解析、修复阶梯和提交由 runtime/runner.py 编排。
"""

from __future__ import annotations

from bettertavern.providers import ChatRequest
from bettertavern.runtime.context.assembler import AssembledContext
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "director"


def director_request(context: AssembledContext, route: ResolvedRoute) -> ChatRequest:
    return ChatRequest(
        messages=context.messages,
        model=route.model,
        max_tokens=route.max_tokens,
        temperature=route.temperature,
        top_p=route.params.top_p,
        reasoning=route.reasoning(),
    )
