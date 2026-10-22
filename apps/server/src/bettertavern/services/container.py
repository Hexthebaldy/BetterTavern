"""服务容器：把引擎、密钥、provider 层、runtime 与各个用例服务装配在一起（由 entrypoints 创建）。"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.keyring import AppSecrets
from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.providers.transport import build_http_client
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.memory_runner import MemoryRunner, MemoryRunnerConfig
from bettertavern.runtime.outline_runner import OutlineRunner, OutlineRunnerConfig
from bettertavern.runtime.prompts import PromptBook
from bettertavern.runtime.runner import RunnerConfig, TurnRunner, TurnRunnerPool
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig
from bettertavern.runtime.workbench_runner import WorkbenchRunner, WorkbenchRunnerConfig

from .auth_service import AuthService
from .card_service import CardService
from .cover_service import CoverService
from .draft_service import DraftService
from .maintenance import Maintenance
from .memory_store import PgMemoryStore
from .outline_store import PgOutlineStore
from .playthrough_service import PlaythroughService
from .recall_store import PgRecallStore
from .route_service import RouteService
from .scenario_service import ScenarioService
from .state_store import PgStateStore
from .tool_route_service import ToolRouteService
from .turn_service import TurnService
from .turn_store import PgTurnStore
from .web_store import PgWebStore
from .workbench_service import WorkbenchService
from .workbench_store import PgWorkbenchStore


@dataclass
class Services:
    engine: AsyncEngine
    hub: ProviderHub
    buffers: EventBufferRegistry
    runners: TurnRunnerPool
    auth: AuthService
    routes: RouteService
    scenarios: ScenarioService
    cards: CardService
    drafts: DraftService
    workbench: WorkbenchService
    tool_routes: ToolRouteService
    covers: CoverService
    http: httpx.AsyncClient  # 联网和出图的出站请求（走防内网访问的网络层）
    playthroughs: PlaythroughService
    turns: TurnService
    maintenance: Maintenance

    async def aclose(self, *, grace: float) -> None:
        await self.runners.shutdown(grace)
        await self.workbench.aclose()
        await self.http.aclose()
        await self.hub.aclose()


def build_services(
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    buffers: EventBufferRegistry,
    access_ttl_s: int,
    refresh_ttl_s: int,
    runner_config: RunnerConfig,
    instance_id: str,
    prompts: PromptBook | None = None,
    rollback_limit: int = 1,
    http: httpx.AsyncClient | None = None,
) -> Services:
    prompts = prompts or PromptBook()
    signer = AccessTokenSigner(secrets.auth_secret, ttl_s=access_ttl_s)
    routes = RouteService(engine, secrets.keyring, hub, policy)
    store = PgTurnStore(engine)
    runner = TurnRunner(
        store=store,
        routes=routes,
        hub=hub,
        prompts=prompts,
        config=runner_config,
        recall=PgRecallStore(engine),
    )
    runners = TurnRunnerPool(runner, buffers)
    scenarios = ScenarioService(engine)
    http = http or build_http_client(policy)
    tool_routes = ToolRouteService(engine, secrets.keyring, policy, client=http)
    return Services(
        engine=engine,
        hub=hub,
        buffers=buffers,
        runners=runners,
        auth=AuthService(engine, signer, refresh_ttl_s=refresh_ttl_s),
        routes=routes,
        scenarios=scenarios,
        cards=CardService(engine),
        drafts=DraftService(engine, scenarios),
        workbench=WorkbenchService(engine),
        tool_routes=tool_routes,
        covers=CoverService(engine, tool_routes, http),
        http=http,
        playthroughs=PlaythroughService(
            engine,
            routes,
            runners,
            lease_ttl_s=runner_config.lease_ttl_s,
            instance_id=instance_id,
            rollback_limit=rollback_limit,
        ),
        turns=TurnService(
            engine,
            routes,
            runners,
            buffers,
            lease_ttl_s=runner_config.lease_ttl_s,
            instance_id=instance_id,
        ),
        maintenance=Maintenance(engine),
    )


def build_state_runner(
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    config: StateRunnerConfig,
    prompts: PromptBook | None = None,
) -> StateRunner:
    """worker 进程用：后台整理世界状态。"""
    routes = RouteService(engine, secrets.keyring, hub, policy)
    return StateRunner(
        store=PgStateStore(engine),
        routes=routes,
        hub=hub,
        prompts=prompts or PromptBook(),
        config=config,
    )


def build_memory_runner(
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    config: MemoryRunnerConfig,
    prompts: PromptBook | None = None,
) -> MemoryRunner:
    """worker 进程用：后台章节整理。"""
    routes = RouteService(engine, secrets.keyring, hub, policy)
    return MemoryRunner(
        store=PgMemoryStore(engine),
        routes=routes,
        hub=hub,
        prompts=prompts or PromptBook(),
        config=config,
    )


def build_outline_runner(
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    config: OutlineRunnerConfig | None = None,
    prompts: PromptBook | None = None,
) -> OutlineRunner:
    """worker 进程用：后台大纲修订。"""
    routes = RouteService(engine, secrets.keyring, hub, policy)
    return OutlineRunner(
        store=PgOutlineStore(engine),
        routes=routes,
        hub=hub,
        prompts=prompts or PromptBook(),
        config=config,
    )


def build_workbench_runner(
    *,
    engine: AsyncEngine,
    secrets: AppSecrets,
    hub: ProviderHub,
    policy: EndpointPolicy,
    config: WorkbenchRunnerConfig | None = None,
    prompts: PromptBook | None = None,
    http: httpx.AsyncClient | None = None,
) -> WorkbenchRunner:
    """worker 进程用：工作台的 agent（联网和出图走 http，不给时新建一个，由调用方负责关闭）。"""
    routes = RouteService(engine, secrets.keyring, hub, policy)
    client = http or build_http_client(policy)
    web_store = PgWebStore(engine)
    return WorkbenchRunner(
        store=PgWorkbenchStore(engine, notes=web_store),
        routes=routes,
        hub=hub,
        prompts=prompts or PromptBook(),
        config=config,
        tools=ToolRouteService(engine, secrets.keyring, policy, client=client),
        web_store=web_store,
        http=client,
        policy=policy,
    )
