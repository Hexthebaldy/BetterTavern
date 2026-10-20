"""agent runtime 的骨架：agent 定义、工具注册表、执行循环、每一步的记录。

设计见 docs/agent-runtime.md 第 5 节。
"""

from .loop import ModelCall, ModelReply, run_agent
from .spec import AgentSpec, OutputKind
from .steps import AgentStep, StepLog, clip_text
from .tools import Tool, ToolError, ToolOutcome, ToolRegistry, parse_arguments

__all__ = [
    "AgentSpec",
    "AgentStep",
    "ModelCall",
    "ModelReply",
    "OutputKind",
    "StepLog",
    "Tool",
    "ToolError",
    "ToolOutcome",
    "ToolRegistry",
    "clip_text",
    "parse_arguments",
    "run_agent",
]
