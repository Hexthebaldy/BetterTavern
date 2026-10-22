"""服务容器：把引擎、密钥、provider 层、runtime 与各个用例服务装配在一起（由 entrypoints 创建）。"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine

from bettertavern.infra.crypto.keyring import AppSecrets
from bettertavern.infra.crypto.tokens import AccessTokenSigner
from bettertavern.infra.mail import MailSender
from bettertavern.providers import EndpointPolicy, ProviderHub
from bettertavern.providers.transport import build_http_client
from bettertavern.runtime.events.buffer import EventBufferRegistry
from bettertavern.runtime.memory_runner import MemoryRunner, MemoryRunnerConfig
from bettertavern.runtime.outline_runner import OutlineRunner, OutlineRunnerConfig
from bettertavern.runtime.prompts import PromptBook
from bettertavern.runtime.runner import RunnerConfig, TurnRunner, TurnRunnerPool
from bettertavern.runtime.state_runner import StateRunner, StateRunnerConfig
from bettertavern.runtime.workbench_runner import WorkbenchRunner, WorkbenchRunnerConfig

from .auth_service import AccountPolicy, AuthService
from .card_service import CardService
from .cover_service import CoverService
from .draft_service import DraftService
from .maintenance import Maintenance
from .memory_store import PgMemoryStore
from .outline_store import PgOutlineStore
from .playthrough_service import PlaythroughService
from .quotas import Quotas
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
    mailer: MailSender | None = None

    async def aclose(self, *, grace: float) -> None:
        await self.runners.shutdown(grace)
        await self.workbench.aclose()
        await self.http.aclose()
        await self.hub.aclose()
        if self.mailer is not None:
            await self.mailer.aclose()


def email_code_key(auth_secret: bytes) -> bytes:
    """邮箱验证码的 HMAC 密钥：从 AUTH_SECRET 派生（和签令牌用的不是同一把）。"""
    return hmac.new(auth_secret, b"bettertavern/email-code", hashlib.sha256).digest()


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
    account_policy: AccountPolicy | None = None,
    mailer: MailSender | None = None,
    quotas: Quotas | None = None,
) -> Services:
    prompts = prompts or PromptBook()
    account_policy = account_policy or AccountPolicy()
    quotas = quotas or Quotas()
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
        auth=AuthService(
            engine,
            signer,
            refresh_ttl_s=refresh_ttl_s,
            policy=account_policy,
            mailer=mailer,
            code_key=email_code_key(secrets.auth_secret),
        ),
        routes=routes,
        scenarios=scenarios,
        cards=CardService(engine),
        drafts=DraftService(engine, scenarios, quotas),
        workbench=WorkbenchService(engine, quotas=quotas),
        tool_routes=tool_routes,
        covers=CoverService(engine, tool_routes, http, quotas),
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
        maintenance=Maintenance(engine, purge_unverified=account_policy.verification_required),
        mailer=mailer,
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
    quotas: Quotas | None = None,
) -> WorkbenchRunner:
    """worker 进程用：工作台的 agent（联网和出图走 http，不给时新建一个，由调用方负责关闭）。"""
    routes = RouteService(engine, secrets.keyring, hub, policy)
    client = http or build_http_client(policy)
    web_store = PgWebStore(engine, quotas)
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
