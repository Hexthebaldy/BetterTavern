"""运行时的路由：已解密的凭据、模型、有效能力与有效窗口。只活在一次调用里，不缓存。"""

from __future__ import annotations

from dataclasses import dataclass

from bettertavern.domain.memory.thresholds import WindowCheck, effective_window
from bettertavern.domain.routing import RouteParams, RouteTask
from bettertavern.providers import Capabilities, ReasoningConfig, ResolvedCredential

# 能力表与探测都没给出窗口时的保守值（与 capabilities.yaml 的兜底规则一致）
DEFAULT_MODEL_WINDOW = 32_768


def window_for(caps: Capabilities, params: RouteParams, task: RouteTask) -> WindowCheck:
    model_window = caps.context_window or DEFAULT_MODEL_WINDOW
    return effective_window(model_window, params.working_cap(), params.max_tokens_for(task))


@dataclass(frozen=True)
class ResolvedRoute:
    route_id: str
    task: RouteTask
    provider: str
    model: str
    credential: ResolvedCredential
    caps: Capabilities
    params: RouteParams
    window: WindowCheck
    fallback: ResolvedRoute | None = None

    @property
    def max_tokens(self) -> int:
        return self.params.max_tokens_for(self.task)

    @property
    def temperature(self) -> float | None:
        return self.params.temperature_for(self.task)

    def reasoning(self) -> ReasoningConfig | None:
        """默认关闭思考；能力表说不支持开关的模型不带这个字段。"""
        if self.caps.reasoning.control == "none":
            return None
        return ReasoningConfig(enabled=self.params.thinking)

    def __repr__(self) -> str:
        return f"ResolvedRoute({self.task.value}, {self.provider}/{self.model})"
