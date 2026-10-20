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
from bettertavern.domain.world.records import RowChange, WorldRecords
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import WorldSnapshot
from bettertavern.providers import Usage

from .agent.steps import AgentStep
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
    # 世界状态已整理到第几回合（-1 表示还没整理过）：状态块开头写“截至第几回合”
    state_seq: int = -1


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
    # 这次运行里的每一步（调模型、用工具），写进 agent_steps
    steps: tuple[AgentStep, ...] = ()


@dataclass(frozen=True)
class TurnOutcome:
    narrative: str
    options: list[TurnOption]
    options_source: str | None  # 结局那一轮没有选项，是 None
    usage: Usage | None
    state_seq: int  # 这一回合的状态块截至第几回合
    runs: list[AgentRunRecord]
    ends_story: bool = False  # 结局写完了：提交时把这局标为 ended


@dataclass(frozen=True)
class TurnFailure:
    code: str
    message: str
    retryable: bool
    partial: bool = False
    narrative: str = ""
    runs: list[AgentRunRecord] = field(default_factory=list)
    # 服务商错误的类别（auth、billing、rate_limit……），客户端按它翻译；不是服务商错误时为 None
    reason: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
            "partial": self.partial,
            "reason": self.reason,
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

    async def renew_lease(self, header: TurnHeader, ttl_s: float) -> bool: ...

    async def commit_turn(self, header: TurnHeader, outcome: TurnOutcome) -> bool:
        """一个事务：回合落库、头部前移、清租约、写账本（结局还要标记这局已完结）。
        普通回合存为 replied，同时放一个整理世界状态的任务；结局直接是 committed。
        围栏不满足返回 False。"""
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


# ---- 世界状态 agent（后台） --------------------------------------------------------------


@dataclass(frozen=True)
class StateTurn:
    """世界状态 agent 要整理的一回合，连同它需要的资料（由服务层一次查好）。"""

    turn_id: str
    playthrough_id: str
    user_id: str
    seq: int
    epoch: int
    language: str
    action: PlayerAction
    narrative: str
    recent: tuple[tuple[int, str], ...]  # 前几回合的（回合，一句话摘要），按回合升序
    scene_start: int  # 当前场景从第几回合开始
    world: WorldRecords
    failures: int = 0  # 这一回合之前整理失败过几次


@dataclass(frozen=True)
class StateCommit:
    changes: tuple[RowChange, ...]
    digest: str
    entity_ids: tuple[str, ...]
    scene_ended: bool
    run: AgentRunRecord


class StateStore(Protocol):
    async def next_turn(self, playthrough_id: str) -> StateTurn | None:
        """还没整理的最早一回合；都整理完了，或者下一回合还没写完，返回 None。"""
        ...

    async def commit(self, turn: StateTurn, result: StateCommit) -> bool:
        """一个事务：整理进度前进一回合、写世界状态和撤销记录、写回合标签、回合标为 committed、
        记下这次运行。整理进度或时间线编号对不上（期间回退过、已经整理过）时什么都不写，
        运行记为 stale，返回 False。"""
        ...

    async def fail(self, turn: StateTurn, run: AgentRunRecord) -> None:
        """记下一次失败的整理；世界状态不变，下一回合的任务会再从这一回合开始。"""
        ...

    async def skip(self, turn: StateTurn, run: AgentRunRecord) -> bool:
        """失败次数用完：记下这次失败，回合标签留空并标为跳过，整理进度照样前进。"""
        ...
