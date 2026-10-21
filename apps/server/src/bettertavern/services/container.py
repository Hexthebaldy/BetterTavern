"""服务容器：把引擎、密钥、provider 层、runtime 与各个用例服务装配在一起（由 entrypoints 创建）。"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.keyring import AppSecrets
from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.prompts import PromptBook
from bettertavern.runtime.runner import RunnerConfig, TurnRunner, TurnRunnerPool
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig

from .auth_service import AuthService
from .maintenance import Maintenance
from .playthrough_service import PlaythroughService
from .recall_store import PgRecallStore
from .route_service import RouteService
from .scenario_service import ScenarioService
from .state_store import PgStateStore
from .turn_service import TurnService
from .turn_store import PgTurnStore


@dataclass
class Services:
    engine: AsyncEngine
    hub: ProviderHub
    buffers: EventBufferRegistry
    runners: TurnRunnerPool
    auth: AuthService
    routes: RouteService
    scenarios: ScenarioService
    playthroughs: PlaythroughService
    turns: TurnService
    maintenance: Maintenance

    async def aclose(self, *, grace: float) -> None:
        await self.runners.shutdown(grace)
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
    return Services(
        engine=engine,
        hub=hub,
        buffers=buffers,
        runners=runners,
        auth=AuthService(engine, signer, refresh_ttl_s=refresh_ttl_s),
        routes=routes,
        scenarios=ScenarioService(engine),
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
