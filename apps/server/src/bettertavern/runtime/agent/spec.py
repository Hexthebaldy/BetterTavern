"""一个 agent 的定义（docs/agent-runtime.md 第 5 节“Agent 定义”）。

每个 agent 在 `runtime/agents/<name>.py` 里有一份 `AgentSpec`：用哪条模型配置、能用哪些工具、
最多用几轮工具、输出是什么形式。执行循环（`loop.py`）只按这份定义办事。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from bettertavern.domain.routing import RouteTask


class OutputKind(StrEnum):
    # 带标签的流式文字，一边写一边推给玩家（导演）
    TAGGED_STREAM = "tagged_stream"
    # 规定格式的 JSON，走结构化输出阶梯（开局构建、补选项）
    STRUCTURED = "structured"


@dataclass(frozen=True, slots=True)
class AgentSpec:
    name: str  # 写进 agent_runs.agent
    task: RouteTask  # 用哪条模型配置
    output: OutputKind
    tools: tuple[str, ...] = ()  # 能用的工具名；不在这里的工具，模型调用了也不执行
    max_tool_rounds: int = 0  # 最多带工具请求几次；再下一次请求不提供工具，只能给出最终输出

    def __post_init__(self) -> None:
        if self.max_tool_rounds < 0:
            raise ValueError("max_tool_rounds can't be negative")
        if self.max_tool_rounds and not self.tools:
            raise ValueError("an agent with tool rounds needs tools")
