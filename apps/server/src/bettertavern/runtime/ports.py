"""runtime 访问持久化与路由的接口。具体实现由 services 提供，在 entrypoints 里注入。

这样热路径的执行器和 agent 能用内存里的假实现单测，不依赖数据库。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.domain.story.turn import PlayerAction, TurnOption
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import WorldSnapshot
from bettertavern.providers import Usage

from .routing import ResolvedRoute


@dataclass(frozen=True, slots=True)
class Preferences:
    """玩家在开局时设的偏好：篇幅、文风、内容边界。"""

    length: Literal["short", "medium", "long"] = "medium"
    style: str = ""
    boundaries: str = ""

    @classmethod
    def from_json(cls, data: Mapping[str, Any] | None) -> Preferences:
        data = data or {}
        length = data.get("length")
        return cls(
            length=length if length in ("short", "medium", "long") else "medium",
            style=str(data.get("style") or "")[:200],
            boundaries=str(data.get("boundaries") or "")[:300],
        )


@dataclass(frozen=True, slots=True)
class TurnHeader:
    """runner 需要的回合基本信息（加载一次）。"""

    turn_id: str
    playthrough_id: str
    user_id: str
    seq: int
    attempt: int
    epoch: int
    status: str
    world_ready: bool
    language: str = "zh"


@dataclass(frozen=True, slots=True)
class HistoryTurn:
    seq: int
    action: PlayerAction
    narrative: str


@dataclass(frozen=True)
class TurnContext:
    header: TurnHeader
    action: PlayerAction
    protagonist_name: str
    preferences: Preferences
    seed: Seed | None
    history: tuple[HistoryTurn, ...]
    world: WorldSnapshot


@dataclass(frozen=True, slots=True)
class AgentRunRecord:
    agent: str
    task: str
    status: Literal["ok", "failed", "stale", "cancelled"]
    provider: str | None = None
    model: str | None = None
    prompt_hash: str | None = None
    usage: Usage | None = None
    ttft_ms: int | None = None
    latency_ms: int | None = None
    error_class: str | None = None
    result: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TurnOutcome:
    narrative: str
    options: list[TurnOption]
    options_source: str
    usage: Usage | None
    state_lag: bool
    runs: list[AgentRunRecord]


@dataclass(frozen=True)
class TurnFailure:
    code: str
    message: str
    retryable: bool
    partial: bool = False
    narrative: str = ""
    runs: list[AgentRunRecord] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "partial": self.partial,
        }


@dataclass(frozen=True)
class WorldBuildInput:
    card: CharacterCard | None
    protagonist_name: str
    protagonist_summary: str
    preferences: Preferences


class TurnStore(Protocol):
    async def load_header(self, turn_id: str) -> TurnHeader | None: ...

    async def load_context(self, header: TurnHeader) -> TurnContext: ...

    async def wait_parent_committed(self, header: TurnHeader, timeout: float) -> bool:
        """屏障：等上一回合的状态提交（state 车道）。超时返回 False，回合带 state_lag 继续。"""
        ...

    async def renew_lease(self, header: TurnHeader, ttl_s: float) -> bool: ...

    async def commit_turn(self, header: TurnHeader, outcome: TurnOutcome) -> bool:
        """一个事务：回合落库、头部前移、清租约、写账本。围栏不满足返回 False。"""
        ...

    async def fail_turn(self, header: TurnHeader, failure: TurnFailure) -> bool: ...

    async def world_build_input(self, header: TurnHeader) -> WorldBuildInput: ...

    async def save_world(
        self, header: TurnHeader, seed: Seed, source: str, run: AgentRunRecord | None
    ) -> int:
        """写入开局世界（实体、关系、事实），playthrough 置为 active。返回实体数量。"""
        ...


class RouteResolver(Protocol):
    async def resolve(
        self, user_id: str, task: RouteTask, playthrough_id: str | None = None
    ) -> ResolvedRoute | None: ...

    async def note_window(self, user_id: str, route_id: str, window: int) -> bool:
        """服务商报超长时写明了模型的真实上限：记到这个路由上（只会往小调）。返回是否改了。"""
        ...
