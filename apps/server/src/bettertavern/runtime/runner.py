"""TurnRunner：一个回合的热路径执行器（api 进程内，生成与客户端连接解耦）。

步骤：（开场且世界未建好时）WorldBuilder → 状态屏障 → 装配上下文 → 导演流式生成（边收边解析，
叙述增量合并成至少 40 毫秒一批发出）→ 修复阶梯 → 一个事务提交 → options.ready、turn.completed。

- 生成期间每 30 秒续租；续租失败（租约被清理或发生了回退）就取消生成，不再写库；
- 首个可见内容之前出错：同一路由退避重试，再试 fallback 路由；之后出错不重试，半截叙述存为草稿；
- 厂商报超窗：截断到有效窗口的 85% 后重试一次；
- 玩家取消、进程关闭都通过 CancelToken 关闭上游连接，回合置为 failed。

M1 还没有 StateKeeper，回合提交时直接置为 committed（状态车道在 M2 接入后改为 replied 并入队）。
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.domain.memory.thresholds import overflow_retry_budget
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.options import fallback_options
from bettertavern.domain.story.turn import OptionsSource, make_options
from bettertavern.domain.world.seed import ProtagonistSeed, Seed, minimal_seed
from bettertavern.providers import (
    CancelToken,
    ProviderError,
    ProviderHub,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout

from .agents.director import AGENT as DIRECTOR_AGENT
from .agents.options_repair import repair_options
from .agents.world_builder import build_seed, failure_run
from .context.assembler import AssembledContext, ContextAssembler, ContextTooLarge
from .events.buffer import EventStream, StreamClosed
from .ports import (
    AgentRunRecord,
    RouteResolver,
    TurnContext,
    TurnFailure,
    TurnHeader,
    TurnOutcome,
    TurnStore,
)
from .prompts import PromptLibrary
from .protocol.director_parser import ParseStage
from .protocol.repair import NarrativeMissing, finalize_director_output
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute
from .runner_pool import TurnRunnerPool
from .turn_stream import (
    DirectorStreamer,
    Generation,
    StreamFailed,
    failure_from_provider,
    usage_json,
)

__all__ = ["LEASE_LOST", "RunnerConfig", "TurnFailed", "TurnRunner", "TurnRunnerPool"]

log = structlog.get_logger(__name__)

_STAGE_TO_SOURCE = {
    ParseStage.OK: OptionsSource.MODEL,
    ParseStage.SALVAGED: OptionsSource.MODEL,
    ParseStage.REPAIRED: OptionsSource.REPAIRED,
    ParseStage.FALLBACK: OptionsSource.FALLBACK,
}


@dataclass(frozen=True)
class RunnerConfig:
    lease_ttl_s: float = 120.0
    lease_renew_s: float = 30.0
    barrier_timeout_s: float = 8.0
    world_builder_timeout_s: float = 30.0
    options_repair_timeout_s: float = 5.0
    delta_batch_s: float = 0.04
    limiter_timeout_s: float = 30.0


# 与清理任务写进库里的错误一致（infra 的 RUNNER_LOST_ERROR）
LEASE_LOST = TurnFailure(code="RUNNER_LOST", message="生成进程意外中止，请重试", retryable=True)


class TurnFailed(Exception):
    def __init__(self, failure: TurnFailure) -> None:
        super().__init__(failure.message)
        self.failure = failure


class TurnRunner:
    def __init__(
        self,
        *,
        store: TurnStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptLibrary,
        config: RunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self._assembler = ContextAssembler(prompts)
        self.config = config or RunnerConfig()
        self._clock = clock
        self._streamer = DirectorStreamer(
            hub,
            clock=clock,
            delta_batch_s=self.config.delta_batch_s,
            limiter_timeout_s=self.config.limiter_timeout_s,
        )

    # ---- 入口 ---------------------------------------------------------------------------
    async def run(self, header: TurnHeader, stream: EventStream, cancel: CancelToken) -> None:
        # 每个回合在自己的 asyncio task 里跑：这里绑定的编号只出现在这个回合的日志里。
        # 请求单号和用户代号是从提交它的那次请求继承来的
        structlog.contextvars.bind_contextvars(
            playthrough_id=header.playthrough_id,
            turn_id=header.turn_id,
            seq=header.seq,
            turn_attempt=header.attempt,
        )
        renewer = asyncio.create_task(self._renew_lease(header, cancel))
        started = self._clock()
        log.info("turn.started", world_ready=header.world_ready)
        try:
            await self._publish(
                stream,
                "turn.created",
                {"turn_id": header.turn_id, "seq": header.seq, "attempt": header.attempt},
            )
            outcome = await self._run(header, stream, cancel)
            if not await self._store.commit_turn(header, outcome):
                # 提交时围栏不满足：租约过期被清理任务收走了（回合已标为 RUNNER_LOST）。
                # 结果作废；推给客户端的错误与库里一致，重新加载后看到的也是同一个错误
                log.warning("turn.commit_rejected")
                await self._fail(header, stream, LEASE_LOST, started=started)
                return
            log.info(
                "turn.committed",
                duration_ms=self._elapsed_ms(started),
                options=len(outcome.options),
                options_source=outcome.options_source,
                state_lag=outcome.state_lag,
            )
            await self._publish(
                stream,
                "options.ready",
                {
                    "options": [o.to_json() for o in outcome.options],
                    "source": outcome.options_source,
                },
            )
            await self._publish(
                stream,
                "turn.completed",
                {
                    "turn": {
                        "id": header.turn_id,
                        "seq": header.seq,
                        "attempt": header.attempt,
                        "status": "committed",
                        "narrative": outcome.narrative,
                        "options": [o.to_json() for o in outcome.options],
                        "options_source": outcome.options_source,
                        "state_lag": outcome.state_lag,
                    },
                    "usage": usage_json(outcome.usage),
                },
            )
        except TurnFailed as exc:
            await self._fail(header, stream, exc.failure, started=started, cancel=cancel)
        except ProviderError as exc:
            await self._fail(
                header, stream, failure_from_provider(exc), started=started, cancel=cancel
            )
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await asyncio.shield(
                    self._fail(
                        header,
                        stream,
                        TurnFailure(
                            code="CANCELLED", message="服务正在重启，请重试", retryable=True
                        ),
                        started=started,
                    )
                )
            raise
        except Exception:
            log.exception("turn.crashed")
            await self._fail(
                header,
                stream,
                TurnFailure(code="INTERNAL_ERROR", message="服务端出错了，请重试", retryable=True),
                started=started,
            )
        finally:
            renewer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renewer
            await stream.close()

    async def _publish(self, stream: EventStream, event: str, data: dict[str, Any]) -> None:
        with contextlib.suppress(StreamClosed):
            await stream.publish(event, data)

    async def _fail(
        self,
        header: TurnHeader,
        stream: EventStream,
        failure: TurnFailure,
        *,
        started: float | None = None,
        cancel: CancelToken | None = None,
    ) -> None:
        # 只记错误码和说明，半截的叙述（failure.narrative）不进日志
        log.warning(
            "turn.failed",
            code=failure.code,
            message=failure.message,
            retryable=failure.retryable,
            partial=failure.partial,
            cancel_reason=cancel.reason if cancel is not None else None,
            duration_ms=self._elapsed_ms(started) if started is not None else None,
        )
        try:
            await self._store.fail_turn(header, failure)
        except Exception:
            log.exception("turn.fail_mark_failed", code=failure.code)
        await self._publish(stream, "turn.failed", failure.to_json())

    async def _renew_lease(self, header: TurnHeader, cancel: CancelToken) -> None:
        while True:
            await asyncio.sleep(self.config.lease_renew_s)
            try:
                ok = await self._store.renew_lease(header, self.config.lease_ttl_s)
            except Exception:
                log.warning("turn.lease_renew_failed", exc_info=True)
                continue
            if not ok:
                cancel.cancel("lease_lost")
                return

    # ---- 主流程 -------------------------------------------------------------------------
    async def _run(
        self, header: TurnHeader, stream: EventStream, cancel: CancelToken
    ) -> TurnOutcome:
        if not header.world_ready:
            await self._build_world(header, stream, cancel)
        state_lag = False
        if header.seq > 0 and not await self._store.wait_parent_committed(header, 0.0):
            started = self._clock()
            await self._publish(stream, "turn.waiting_state", {"waited_ms": 0})
            committed = await self._store.wait_parent_committed(
                header, self.config.barrier_timeout_s
            )
            state_lag = not committed
            # 等上一轮的状态写完（M1 不会等，M2 接入状态车道后才有意义）
            log.info("turn.barrier_waited", duration_ms=self._elapsed_ms(started), lag=state_lag)
            await self._publish(
                stream,
                "turn.waiting_state",
                {
                    "waited_ms": int((self._clock() - started) * 1000),
                    "done": True,
                    "lag": state_lag,
                },
            )
        cancel.raise_if_cancelled()
        ctx = await self._store.load_context(header)
        route = await self._routes.resolve(
            header.user_id, RouteTask.DIRECTOR, header.playthrough_id
        )
        if route is None:
            raise TurnFailed(
                TurnFailure(
                    code="ROUTE_MISSING",
                    message="还没有配置导演用的模型，请先在设置里添加密钥并选择模型",
                    retryable=False,
                )
            )
        generation = await self._generate(header, ctx, route, stream, cancel)
        return await self._finalize(header, generation, state_lag)

    async def _build_world(
        self, header: TurnHeader, stream: EventStream, cancel: CancelToken
    ) -> None:
        log.info("world.build.started")
        await self._publish(stream, "world.building", {})
        inp = await self._store.world_build_input(header)
        route = await self._routes.resolve(
            header.user_id, RouteTask.WORLD_BUILDER, header.playthrough_id
        )
        seed: Seed | None = None
        source = "minimal"
        run: AgentRunRecord | None = None
        started = self._clock()
        if route is not None and inp.card is not None:
            try:
                async with asyncio.timeout(self.config.world_builder_timeout_s):
                    async with self._hub.limiter.slot(
                        route.credential.credential_id,
                        interactive=True,
                        timeout=self.config.limiter_timeout_s,
                    ):
                        result = await build_seed(
                            route,
                            self._hub.adapter(route.provider),
                            inp.card,
                            inp,
                            prompts=self._prompts,
                            negative_cache=self._hub.negative_cache,
                            cancel=cancel,
                        )
                seed, source, run = result.seed, "world_builder", result.run
            except TimeoutError:
                run = failure_run(route, "timeout", "WorldBuilder 超时", self._elapsed_ms(started))
            except ProviderError as exc:
                if exc.error_class is ErrorClass.CANCELLED:
                    raise
                run = failure_run(
                    route, exc.error_class.value, exc.message, self._elapsed_ms(started)
                )
            except (StructuredOutputError, LimiterTimeout) as exc:
                run = failure_run(route, type(exc).__name__, str(exc), self._elapsed_ms(started))
        cancel.raise_if_cancelled()
        if seed is None:
            if inp.card is not None:
                seed = minimal_seed(
                    inp.card,
                    protagonist_name=inp.protagonist_name,
                    protagonist_summary=inp.protagonist_summary,
                )
            else:
                seed = Seed(
                    protagonist=ProtagonistSeed(
                        name=inp.protagonist_name, summary=inp.protagonist_summary
                    )
                )
        count = await self._store.save_world(header, seed, source, run)
        # source=minimal 表示 WorldBuilder 没成功（或没配模型），退回只用角色卡文字搭的最小世界
        log.info(
            "world.build.done",
            duration_ms=self._elapsed_ms(started),
            source=source,
            entities=count,
            provider=route.provider if route is not None else None,
            model=route.model if route is not None else None,
            error_class=run.error_class if run is not None else None,
        )
        await self._publish(stream, "world.ready", {"source": source, "entities": count})

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)

    async def _generate(
        self,
        header: TurnHeader,
        ctx: TurnContext,
        route: ResolvedRoute,
        stream: EventStream,
        cancel: CancelToken,
    ) -> Generation:
        try:
            context = self._assembler.assemble(ctx, route.window.effective_window)
        except ContextTooLarge as exc:
            raise TurnFailed(
                TurnFailure(code="CONTEXT_TOO_LARGE", message=str(exc), retryable=False)
            ) from exc
        self._log_context(context, route)
        attempt_route = route
        fallback_used = False
        overflow_retried = False
        while True:
            try:
                generation = await self._streamer.stream(
                    attempt_route,
                    context,
                    lambda event, data: self._publish(stream, event, data),
                    cancel,
                )
                generation.fallback_used = fallback_used
                return generation
            except StreamFailed as failed:
                error = failed.error
                if failed.streamed:
                    raise TurnFailed(failure_from_provider(error, failed.streamed)) from error
                if error.error_class is ErrorClass.CONTEXT_OVERFLOW and not overflow_retried:
                    overflow_retried = True
                    window = attempt_route.window.effective_window
                    log.warning("turn.context_overflow_retry", window=window)
                    try:
                        context = self._assembler.assemble(
                            ctx, window, budget=overflow_retry_budget(window)
                        )
                    except ContextTooLarge as exc:
                        raise TurnFailed(failure_from_provider(error)) from exc
                    self._log_context(context, attempt_route)
                    continue
                fallback = attempt_route.fallback
                if fallback is not None and error.policy.fallback and not fallback_used:
                    log.warning(
                        "turn.fallback",
                        error_class=error.error_class.value,
                        from_model=attempt_route.model,
                        to_provider=fallback.provider,
                        to_model=fallback.model,
                    )
                    fallback_used = True
                    attempt_route = fallback
                    try:
                        context = self._assembler.assemble(ctx, fallback.window.effective_window)
                    except ContextTooLarge as exc:
                        raise TurnFailed(failure_from_provider(error)) from exc
                    self._log_context(context, fallback)
                    continue
                raise TurnFailed(failure_from_provider(error)) from error

    async def _finalize(
        self, header: TurnHeader, generation: Generation, state_lag: bool
    ) -> TurnOutcome:
        route = generation.route

        async def repair(narrative: str, existing: Any) -> list[str]:
            # 修复用 repair 路由（没配置就沿用导演路由），只在确实缺选项时才解析
            target = (
                await self._routes.resolve(header.user_id, RouteTask.REPAIR, header.playthrough_id)
                or route
            )
            repair_started = self._clock()
            try:
                options = await repair_options(
                    self._hub.adapter(target.provider),
                    target.credential,
                    target.caps,
                    model=target.model,
                    prompts=self._prompts,
                    narrative=narrative,
                    existing=list(existing),
                    max_tokens=target.params.max_tokens_for(RouteTask.REPAIR),
                )
            except BaseException as exc:
                log.warning(
                    "options.repair_failed",
                    model=target.model,
                    error_class=type(exc).__name__,
                    duration_ms=self._elapsed_ms(repair_started),
                )
                raise
            log.info(
                "options.repair",
                model=target.model,
                existing=len(list(existing)),
                produced=len(options),
                duration_ms=self._elapsed_ms(repair_started),
            )
            return options

        try:
            outcome = await finalize_director_output(
                generation.parse,
                repair=repair,
                fallback=fallback_options(header.language),
                timeout=self.config.options_repair_timeout_s,
            )
        except NarrativeMissing as exc:
            log.warning("director.parse", stage="narrative_missing")
            run = self._director_run(generation, status="failed", error_class="narrative_missing")
            raise TurnFailed(
                TurnFailure(
                    code="NARRATIVE_MISSING",
                    message="导演这次没有写出内容，请重试",
                    retryable=True,
                    narrative=generation.streamed,
                    partial=bool(generation.streamed),
                    runs=[run],
                )
            ) from exc
        # stage：ok 直接合格；salvaged / repaired 修补后合格；fallback 用了兜底选项
        log.info(
            "director.parse",
            stage=outcome.stage.value,
            options=len(outcome.options),
            repairs=list(outcome.repairs),
            notes=list(outcome.notes)[:10],
            rewritten=generation.parse.rewritten,
        )
        run = self._director_run(
            generation,
            status="ok",
            extra={
                "stage": outcome.stage.value,
                "repairs": list(outcome.repairs),
                "notes": list(outcome.notes)[:10],
            },
        )
        return TurnOutcome(
            narrative=outcome.narrative,
            options=make_options(outcome.options),
            options_source=_STAGE_TO_SOURCE[outcome.stage].value,
            usage=generation.usage,
            state_lag=state_lag,
            runs=[run],
        )

    def _log_context(self, context: AssembledContext, route: ResolvedRoute) -> None:
        # prompt_hash 是提示词的指纹：和上一回合比，前缀没变才能命中服务商的前缀缓存
        log.info(
            "context.assembled",
            provider=route.provider,
            model=route.model,
            window=route.window.effective_window,
            estimated_tokens=context.estimated_tokens,
            usage_ratio=round(context.usage_ratio, 4),
            dropped_turns=context.dropped_turns,
            prompt_hash=context.fingerprint,
        )

    def _director_run(
        self,
        generation: Generation,
        *,
        status: str,
        error_class: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> AgentRunRecord:
        context = generation.context
        result: dict[str, Any] = {
            "route_id": generation.route.route_id,
            "fallback_used": generation.fallback_used,
            "finish_reason": generation.finish_reason,
            "estimated_tokens": context.estimated_tokens,
            "usage_ratio": round(context.usage_ratio, 4),
            "dropped_turns": context.dropped_turns,
            "prompt_versions": context.prompt_versions,
        }
        result.update(extra or {})
        return AgentRunRecord(
            agent=DIRECTOR_AGENT,
            task=RouteTask.DIRECTOR.value,
            status="ok" if status == "ok" else "failed",
            provider=generation.route.provider,
            model=generation.route.model,
            prompt_hash=context.fingerprint,
            usage=generation.usage,
            ttft_ms=generation.ttft_ms,
            latency_ms=generation.latency_ms,
            error_class=error_class,
            result=result,
        )
