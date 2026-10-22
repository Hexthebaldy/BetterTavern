"""模型路由：每个 agent 槽位（task）用哪个凭据的哪个模型，以及采样参数与工作窗口上限。

解析顺序：后台的 task（世界状态 agent、章节整理）用玩家设为“用于后台”的模型，
工作台的 agent 用设为“用于工作台”的模型，其余用导演的模型；没设这两种时也用导演的模型。
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from bettertavern.domain.memory.thresholds import DEFAULT_WORKING_WINDOW


class RouteTask(StrEnum):
    DIRECTOR = "director"
    STATE_KEEPER = "state_keeper"
    OUTLINE = "outline"
    COMPACTOR = "compactor"
    GATE = "gate"
    WORLD_BUILDER = "world_builder"
    REPAIR = "repair"
    WORKBENCH = "workbench"


# 在后台跑、不挡玩家的 task：用“用于后台”的模型（docs/agent-runtime.md 第 4 节）
BACKGROUND_TASKS = frozenset({RouteTask.STATE_KEEPER, RouteTask.OUTLINE, RouteTask.COMPACTOR})


DEFAULT_MAX_TOKENS: dict[RouteTask, int] = {
    RouteTask.DIRECTOR: 4096,
    RouteTask.STATE_KEEPER: 2048,
    RouteTask.OUTLINE: 4096,
    RouteTask.COMPACTOR: 8192,
    RouteTask.GATE: 512,
    RouteTask.WORLD_BUILDER: 8192,
    RouteTask.REPAIR: 256,
    # 工作台的 agent 用工具参数写整段的开场白、世界书，给足
    RouteTask.WORKBENCH: 8192,
}

DEFAULT_TEMPERATURE: dict[RouteTask, float] = {
    RouteTask.DIRECTOR: 0.9,
    RouteTask.STATE_KEEPER: 0.3,
    RouteTask.WORLD_BUILDER: 0.7,
    RouteTask.REPAIR: 0.7,
    RouteTask.WORKBENCH: 0.8,
}


class RouteParams(BaseModel):
    """路由参数。None 表示用默认值；默认所有 task 关闭思考（首 token 更快）。"""

    model_config = ConfigDict(extra="forbid")

    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    max_tokens: int | None = Field(default=None, ge=64, le=65536)
    thinking: bool = False
    # 工作窗口上限 C，默认 128K；runtime 按 min(模型窗口, C) 计算有效窗口
    working_window: int | None = Field(default=None, ge=4096, le=10_000_000)

    def max_tokens_for(self, task: RouteTask) -> int:
        return self.max_tokens or DEFAULT_MAX_TOKENS[task]

    def temperature_for(self, task: RouteTask) -> float | None:
        if self.temperature is not None:
            return self.temperature
        return DEFAULT_TEMPERATURE.get(task)

    def working_cap(self) -> int:
        return self.working_window or DEFAULT_WORKING_WINDOW
