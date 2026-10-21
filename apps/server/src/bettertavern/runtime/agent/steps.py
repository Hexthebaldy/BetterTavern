"""一次 agent 运行里的每一步（docs/agent-runtime.md 第 5 节“记录与重放”）。

每调一次模型、每用一次工具记一步，随这次运行的 `AgentRunRecord` 一起写进 `agent_steps` 表。
参数和结果里有故事文字，所以只进数据库，不进日志。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from bettertavern.providers import Usage

# 一步里存的原文最多这么多字：够重放，又不会因为不守规矩的接口无限变大
MAX_STEP_TEXT = 40_000


@dataclass(frozen=True, slots=True)
class AgentStep:
    kind: Literal["model", "tool"]
    args: Mapping[str, Any]
    result: Mapping[str, Any]
    latency_ms: int | None = None
    usage: Usage | None = None
    tool: str | None = None  # kind 为 tool 时是工具名


class StepLog:
    """按发生的顺序收集一次运行的每一步。"""

    def __init__(self) -> None:
        self._steps: list[AgentStep] = []

    @property
    def steps(self) -> tuple[AgentStep, ...]:
        return tuple(self._steps)

    def __len__(self) -> int:
        return len(self._steps)

    def total_usage(self) -> Usage | None:
        """这次运行所有模型调用的用量之和；一次都没调到时为空。"""
        usages = [s.usage for s in self._steps if s.usage is not None]
        if not usages:
            return None
        return Usage(
            prompt=sum(u.prompt for u in usages),
            completion=sum(u.completion for u in usages),
            cached=sum(u.cached for u in usages),
            reasoning=sum(u.reasoning for u in usages),
        )

    def model(
        self,
        *,
        args: Mapping[str, Any],
        result: Mapping[str, Any],
        latency_ms: int | None = None,
        usage: Usage | None = None,
    ) -> None:
        self._steps.append(
            AgentStep(kind="model", args=args, result=result, latency_ms=latency_ms, usage=usage)
        )

    def tool(
        self,
        name: str,
        *,
        args: Mapping[str, Any],
        result: Mapping[str, Any],
        latency_ms: int | None = None,
    ) -> None:
        self._steps.append(
            AgentStep(kind="tool", tool=name, args=args, result=result, latency_ms=latency_ms)
        )


def clip_text(text: str) -> str:
    return text if len(text) <= MAX_STEP_TEXT else text[:MAX_STEP_TEXT]
