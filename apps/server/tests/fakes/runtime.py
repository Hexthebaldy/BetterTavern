"""runtime 单测用的内存假实现：TurnStore、RouteResolver 和一个可编排的厂商适配器。"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from typing import Any

import httpx

from bettertavern.domain.memory.thresholds import effective_window
from bettertavern.domain.routing import RouteParams, RouteTask
from bettertavern.domain.story.turn import PlayerAction
from bettertavern.domain.world.seed import Seed
from bettertavern.domain.world.views import WorldSnapshot
from bettertavern.providers import (
    CancelToken,
    Capabilities,
    ChatEvent,
    ChatRequest,
    ChatResult,
    Done,
    EndpointPolicy,
    ModelInfo,
    ProviderError,
    ProviderHub,
    ResolvedCredential,
    Secret,
    TextDelta,
    Usage,
    UsageEvent,
)
from bettertavern.providers.cancel import cancelled_error
from bettertavern.providers.capabilities import CapabilityRule
from bettertavern.providers.profile import ProviderProfile
from bettertavern.providers.registry import ProviderRegistry
from bettertavern.runtime.ports import (
    AgentRunRecord,
    HistoryTurn,
    Preferences,
    TurnContext,
    TurnFailure,
    TurnHeader,
    TurnOutcome,
    WorldBuildInput,
)
from bettertavern.runtime.routing import ResolvedRoute


@dataclass
class StreamScript:
    """一次流式调用：pieces 依次作为 TextDelta 发出；error 在发完 error_after 个片段后抛出。"""

    pieces: list[str]
    error: ProviderError | None = None
    error_after: int = 0
    delay: float = 0.0
    usage: Usage | None = field(default_factory=lambda: Usage(prompt=100, completion=50))


class ScriptedAdapter:
    def __init__(self, profile: ProviderProfile) -> None:
        self._profile = profile
        self.streams: deque[StreamScript] = deque()
        self.completions: deque[ChatResult | ProviderError] = deque()
        self.requests: list[ChatRequest] = []
        # list_models 返回的列表；list_error 不为空时改为抛出它
        self.models: list[ModelInfo] = [ModelInfo(id="fake-model", context_window=65536)]
        self.list_error: ProviderError | None = None
        self.list_calls = 0

    @property
    def profile(self) -> ProviderProfile:
        return self._profile

    def build_body(
        self,
        req: ChatRequest,
        caps: Capabilities,
        *,
        stream: bool,
        cred_extra_body: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {"model": req.model}

    async def stream(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> AsyncIterator[ChatEvent]:
        self.requests.append(req)
        script = self.streams.popleft()
        for index, piece in enumerate(script.pieces):
            if script.error is not None and index == script.error_after:
                raise script.error
            if cancel is not None and cancel.cancelled:
                raise cancelled_error(cancel)
            if script.delay:
                await asyncio.sleep(script.delay)
            yield TextDelta(piece)
        if script.error is not None and script.error_after >= len(script.pieces):
            raise script.error
        if script.usage is not None:
            yield UsageEvent(script.usage)
        yield Done("stop")

    async def complete(
        self,
        req: ChatRequest,
        cred: ResolvedCredential,
        caps: Capabilities,
        *,
        cancel: CancelToken | None = None,
    ) -> ChatResult:
        self.requests.append(req)
        item = self.completions.popleft()
        if isinstance(item, ProviderError):
            raise item
        return item

    async def list_models(self, cred: ResolvedCredential) -> list[ModelInfo]:
        self.list_calls += 1
        if self.list_error is not None:
            raise self.list_error
        return list(self.models)


def result(text: str) -> ChatResult:
    return ChatResult(
        text=text, reasoning="", tool_calls=(), finish_reason="stop", usage=Usage(10, 5)
    )


def scripted_hub(
    *provider_ids: str, rules: list[CapabilityRule] | None = None
) -> tuple[ProviderHub, dict[str, ScriptedAdapter]]:
    registry = ProviderRegistry()
    adapters: dict[str, ScriptedAdapter] = {}

    def factory(profile: ProviderProfile, client: httpx.AsyncClient) -> ScriptedAdapter:
        return adapters[profile.id]

    registry.register_adapter_factory("scripted", factory)
    for pid in provider_ids or ("fake",):
        profile = ProviderProfile(
            id=pid, display_name=pid, default_base_url="https://fake.invalid", adapter="scripted"
        )
        registry.register_provider(profile)
        adapters[pid] = ScriptedAdapter(profile)
    hub = ProviderHub(
        policy=EndpointPolicy(), registry=registry, rules=rules or [], client=httpx.AsyncClient()
    )
    return hub, adapters


def make_route(
    provider: str = "fake",
    *,
    task: RouteTask = RouteTask.DIRECTOR,
    window: int = 65536,
    fallback: ResolvedRoute | None = None,
    caps: Capabilities | None = None,
) -> ResolvedRoute:
    params = RouteParams()
    caps = caps or Capabilities(context_window=window)
    return ResolvedRoute(
        route_id=f"route-{provider}-{task.value}",
        task=task,
        provider=provider,
        model="fake-model",
        credential=ResolvedCredential(
            credential_id=f"cred-{provider}", provider=provider, api_key=Secret("sk-test-123456")
        ),
        caps=caps,
        params=params,
        window=effective_window(window, params.working_cap(), params.max_tokens_for(task)),
        fallback=fallback,
    )


class FakeRoutes:
    def __init__(self, routes: dict[RouteTask, ResolvedRoute] | None = None) -> None:
        self.routes = routes or {}
        # note_window 记下的（route_id, window）
        self.learned: list[tuple[str, int]] = []

    async def resolve(
        self, user_id: str, task: RouteTask, playthrough_id: str | None = None
    ) -> ResolvedRoute | None:
        return self.routes.get(task) or self.routes.get(RouteTask.DIRECTOR)

    async def note_window(self, user_id: str, route_id: str, window: int) -> bool:
        self.learned.append((route_id, window))
        return True


@dataclass
class FakeStore:
    world: WorldSnapshot = field(default_factory=WorldSnapshot)
    seed: Seed | None = None
    history: list[HistoryTurn] = field(default_factory=list)
    action: PlayerAction = field(default_factory=lambda: PlayerAction("text", "我推门"))
    parent_committed_after: float = 0.0
    commit_ok: bool = True
    renew_ok: bool = True
    world_input: WorldBuildInput | None = None
    committed: list[TurnOutcome] = field(default_factory=list)
    failed: list[TurnFailure] = field(default_factory=list)
    saved_world: list[tuple[Seed, str, AgentRunRecord | None]] = field(default_factory=list)
    renewals: int = 0

    async def load_header(self, turn_id: str) -> TurnHeader | None:
        return None

    async def load_context(self, header: TurnHeader) -> TurnContext:
        return TurnContext(
            header=header,
            action=self.action,
            protagonist_name="林川",
            preferences=Preferences(),
            seed=self.seed,
            history=tuple(self.history),
            world=self.world,
        )

    async def wait_parent_committed(self, header: TurnHeader, timeout: float) -> bool:
        if self.parent_committed_after <= 0:
            return True
        if timeout <= 0:
            return False
        await asyncio.sleep(min(timeout, self.parent_committed_after))
        return self.parent_committed_after <= timeout

    async def renew_lease(self, header: TurnHeader, ttl_s: float) -> bool:
        self.renewals += 1
        return self.renew_ok

    async def commit_turn(self, header: TurnHeader, outcome: TurnOutcome) -> bool:
        if self.commit_ok:
            self.committed.append(outcome)
        return self.commit_ok

    async def fail_turn(self, header: TurnHeader, failure: TurnFailure) -> bool:
        self.failed.append(failure)
        return True

    async def world_build_input(self, header: TurnHeader) -> WorldBuildInput:
        assert self.world_input is not None
        return self.world_input

    async def save_world(
        self, header: TurnHeader, seed: Seed, source: str, run: AgentRunRecord | None
    ) -> int:
        self.saved_world.append((seed, source, run))
        self.seed = seed
        return 3


def header(seq: int = 1, *, world_ready: bool = True) -> TurnHeader:
    return TurnHeader(
        turn_id="turn-1",
        playthrough_id="pt-1",
        user_id="user-1",
        seq=seq,
        attempt=0,
        epoch=0,
        status="generating",
        world_ready=world_ready,
    )
