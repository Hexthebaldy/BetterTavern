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
    # 带标签的文字，一次拿到、不推给玩家（闪电模式的压缩）
    TAGGED_TEXT = "tagged_text"
    # 用工具做事，最后调用收尾工具结束（世界状态 agent 的 commit）
    FINISH_TOOL = "finish_tool"
    # 和用户对话：说的话一边生成一边推出去，可以连续调很多次工具；
    # 调用 end_tools 里的工具（发问卷、出方案、给出改动）就结束这一轮，等用户（工作台的 card_maker）
    CHAT = "chat"


@dataclass(frozen=True, slots=True)
class AgentSpec:
    name: str  # 写进 agent_runs.agent
    task: RouteTask  # 用哪条模型配置
    output: OutputKind
    tools: tuple[str, ...] = ()  # 能用的工具名；不在这里的工具，模型调用了也不执行
    max_tool_rounds: int = 0  # 最多带工具请求几次；再下一次请求不提供工具，只能给出最终输出
    # 收尾工具：调用成功就结束；最后一次请求只提供它（OutputKind.FINISH_TOOL 必须有）
    finish_tool: str | None = None
    # 调用成功就结束这一轮的工具（OutputKind.CHAT 用）；和收尾工具不同，不强制模型最后调用
    end_tools: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.max_tool_rounds < 0:
            raise ValueError("max_tool_rounds can't be negative")
        if self.max_tool_rounds and not self.tools:
            raise ValueError("an agent with tool rounds needs tools")
        if (self.output is OutputKind.FINISH_TOOL) != (self.finish_tool is not None):
            raise ValueError("finish_tool goes with OutputKind.FINISH_TOOL")
        if self.finish_tool is not None and self.finish_tool not in self.tools:
            raise ValueError("finish_tool must be one of the agent's tools")
        if any(name not in self.tools for name in self.end_tools):
            raise ValueError("end_tools must be among the agent's tools")
