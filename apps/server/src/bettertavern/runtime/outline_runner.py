"""后台大纲修订（docs/agent-runtime.md 第 3 节“后台”、第 4 节“大纲修订”）。

worker 领到一局的大纲任务后调用 process()：还没有大纲时写第一版；有大纲时，把上次修订以来
世界状态 agent 留下的“大纲要改”的原因一起交给模型，由它决定改不改。改了的新一版先过
settle() 修正（domain/memory/outline.py），再写入。

- 写成：在一个事务里写入（OutlineStore.commit），修订进度前进到这次依据到的回合；不改也记一次。
  进度或时间线编号对不上（期间回退过）时整次结果作废。
- 写失败（调模型出错、超时、格式一直不对）：记一次失败就停下，进度不动。世界状态 agent 下一回合
  写入时看到还有没处理的原因（或者还没有大纲），会再放一个任务。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

import structlog

from bettertavern.domain.memory.outline import settle
from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ProviderError, ProviderHub
from bettertavern.providers.limiter import LimiterTimeout

from .agent import StepLog
from .agents.outline_writer import AGENT, write_outline
from .ports import AgentRunRecord, OutlineCommit, OutlineStore, OutlineWork, RouteResolver
from .prompts import PromptBook
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class OutlineRunnerConfig:
    timeout_s: float = 180.0  # 修订一次最多多久，超时算失败


class OutlineRunner:
    def __init__(
        self,
        *,
        store: OutlineStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        config: OutlineRunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self.config = config or OutlineRunnerConfig()
        self._clock = clock

    async def process(self, playthrough_id: str) -> bool:
        """修订一次。返回是否写入了（改或不改都算）。"""
        work = await self._store.pending(playthrough_id)
        if work is None:
            return False
        outcome = await self._run(work)
        if isinstance(outcome, OutlineCommit):
            if await self._store.commit(work, outcome):
                return True
            log.info("outline.stale", playthrough_id=playthrough_id, seq=work.based_on_seq)
            return False
        await self._store.fail(work, outcome)
        return False

    async def _run(self, work: OutlineWork) -> OutlineCommit | AgentRunRecord:
        started = self._clock()
        structlog.contextvars.bind_contextvars(playthrough_id=work.playthrough_id)
        try:
            route = await self._routes.resolve(work.user_id, RouteTask.OUTLINE, work.playthrough_id)
            steps = StepLog()
            if route is None:
                return self._failed(work, None, steps, "route_missing", started)
            try:
                async with asyncio.timeout(self.config.timeout_s):
                    written = await write_outline(
                        route,
                        self._hub.adapter(route.provider),
                        work,
                        self._prompts.get(work.language),
                        steps=steps,
                        negative_cache=self._hub.negative_cache,
                    )
            except TimeoutError:
                return self._failed(work, route, steps, "timeout", started)
            except ProviderError as exc:
                return self._failed(work, route, steps, exc.error_class.value, started)
            except (StructuredOutputError, LimiterTimeout) as exc:
                return self._failed(work, route, steps, type(exc).__name__, started)
            outline = settle(written.outline, work.outline) if written.outline else None
            active = (
                next((b.id for b in outline.beats if b.status == "active"), None)
                if outline
                else None
            )
            log.info(
                "outline.revised",
                seq=work.based_on_seq,
                first=work.outline is None,
                changed=outline is not None,
                reasons=len(work.reasons),
                beats=len(outline.beats) if outline else None,
                active=active,
                duration_ms=self._elapsed_ms(started),
            )
            run = AgentRunRecord(
                agent=AGENT,
                task=RouteTask.OUTLINE.value,
                status="ok",
                provider=route.provider,
                model=route.model,
                prices=route.prices,
                prompt_hash=written.prompt_hash,
                usage=steps.total_usage(),
                latency_ms=self._elapsed_ms(started),
                result={
                    "based_on_seq": work.based_on_seq,
                    "first": work.outline is None,
                    "changed": outline is not None,
                    "reasons": len(work.reasons),
                    "active": active,
                    "mode": written.structured.mode,
                    "attempts": written.structured.attempts,
                },
                steps=steps.steps,
            )
            return OutlineCommit(outline=outline, reason=written.reason, run=run)
        finally:
            structlog.contextvars.unbind_contextvars("playthrough_id")

    def _failed(
        self,
        work: OutlineWork,
        route: ResolvedRoute | None,
        steps: StepLog,
        error_class: str,
        started: float,
    ) -> AgentRunRecord:
        log.warning(
            "outline.failed",
            seq=work.based_on_seq,
            error_class=error_class,
            duration_ms=self._elapsed_ms(started),
        )
        return AgentRunRecord(
            agent=AGENT,
            task=RouteTask.OUTLINE.value,
            status="failed",
            provider=route.provider if route is not None else None,
            model=route.model if route is not None else None,
            prices=route.prices if route is not None else None,
            usage=steps.total_usage(),
            latency_ms=self._elapsed_ms(started),
            error_class=error_class,
            result={"based_on_seq": work.based_on_seq, "first": work.outline is None},
            steps=steps.steps,
        )

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
