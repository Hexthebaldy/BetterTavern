"""TurnRunner：一个回合的热路径执行器（api 进程内，生成与客户端连接解耦）。

步骤：（开场且世界未建好时）WorldBuilder → 状态屏障 → 装配上下文 → 导演流式生成（边收边解析，
叙述增量合并成至少 40 毫秒一批发出）→ 修复阶梯 → 一个事务提交 → options.ready、turn.completed。
结局那一轮（行动来源 ending）只要叙述：不走修复阶梯，模型写了选项也丢掉，提交时把这局标为已完结。

- 生成期间每 30 秒续租；续租失败（租约被清理或发生了回退）就取消生成，不再写库；
- 调模型出错不自动重试、也不换别的模型，这一轮直接失败（玩家自己点重试）；
  已经写出的半截叙述存为草稿；
- 唯一的例外是厂商报超窗：说明我们估算的 token 数偏少或窗口记大了，
  重新装配到有效窗口的 85% 以内再发一次；
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
from .prompts import PromptBook, PromptLibrary
from .protocol.director_parser import MISSING_OPTIONS, ParseStage
from .protocol.repair import NarrativeMissing, finalize_director_output
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute, with_model_window
from .runner_pool import TurnRunnerPool
from .turn_stream import (
    DirectorStreamer,
    Generation,
    GenerationLimitHit,
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
    # 导演写一段的总时长上限（从开流算起）；总字数上限按 max_tokens 换算，见 turn_stream.py
    director_timeout_s: float = 600.0


# 与清理任务写进库里的错误一致（infra 的 RUNNER_LOST_ERROR）
LEASE_LOST = TurnFailure(
    code="RUNNER_LOST", message="Generation stopped unexpectedly, please try again", retryable=True
)


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
        prompts: PromptBook,
        config: RunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        # 每种语言一个装配器；一局用哪种看 playthroughs.language（TurnHeader.language）
        self._assemblers = {
            language: ContextAssembler(prompts.get(language)) for language in prompts.languages
        }
        self.config = config or RunnerConfig()
        self._clock = clock
        self._streamer = DirectorStreamer(
            hub,
            clock=clock,
            delta_batch_s=self.config.delta_batch_s,
            limiter_timeout_s=self.config.limiter_timeout_s,
            max_duration_s=self.config.director_timeout_s,
        )

    def _prompts_for(self, header: TurnHeader) -> PromptLibrary:
        return self._prompts.get(header.language)

    def _assembler_for(self, header: TurnHeader) -> ContextAssembler:
        return self._assemblers.get(header.language) or ContextAssembler(self._prompts_for(header))

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
            if outcome.ends_story:
                # 只记字数，不记结局的内容
                log.info("playthrough.ended", narrative_chars=len(outcome.narrative))
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
                            code="CANCELLED",
                            message="The server is restarting, please try again",
                            retryable=True,
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
                TurnFailure(
                    code="INTERNAL_ERROR",
                    message="Internal server error, please try again",
                    retryable=True,
                ),
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
                    message=(
                        "No director model is set up yet. Add a key and choose a model in Settings"
                    ),
                    retryable=False,
                )
            )
        generation = await self._generate(header, ctx, route, stream, cancel)
        if ctx.action.source == "ending":
            return self._finalize_ending(generation, state_lag)
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
                            prompts=self._prompts_for(header),
                            negative_cache=self._hub.negative_cache,
                            cancel=cancel,
                        )
                seed, source, run = result.seed, "world_builder", result.run
            except TimeoutError:
                run = failure_run(
                    route, "timeout", "WorldBuilder timed out", self._elapsed_ms(started)
                )
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

    async def _learn_window(self, header: TurnHeader, route: ResolvedRoute, window: int) -> None:
        """记下学到的窗口；记不下来（数据库出错）也不影响这一轮用它重试。"""
        try:
            await self._routes.note_window(header.user_id, route.route_id, window)
        except Exception as exc:  # 只是少记一次，不该让回合失败
            log.warning("turn.window_note_failed", error=type(exc).__name__)

    async def _generate(
        self,
        header: TurnHeader,
        ctx: TurnContext,
        route: ResolvedRoute,
        stream: EventStream,
        cancel: CancelToken,
    ) -> Generation:
        try:
            context = self._assembler_for(header).assemble(ctx, route.window.effective_window)
        except ContextTooLarge as exc:
            raise TurnFailed(
                TurnFailure(code="CONTEXT_TOO_LARGE", message=str(exc), retryable=False)
            ) from exc
        self._log_context(context, route)
        attempt_route = route
        overflow_retried = False
        while True:
            try:
                return await self._streamer.stream(
                    attempt_route,
                    context,
                    lambda event, data: self._publish(stream, event, data),
                    cancel,
                )
            except GenerationLimitHit as hit:
                raise TurnFailed(hit.failure) from hit
            except StreamFailed as failed:
                error = failed.error
                if failed.streamed:
                    raise TurnFailed(failure_from_provider(error, failed.streamed)) from error
                if error.error_class is ErrorClass.CONTEXT_OVERFLOW and not overflow_retried:
                    overflow_retried = True
                    limit = error.context_limit
                    learned = limit is not None and limit < attempt_route.window.model_window
                    if learned and limit is not None:
                        # 服务商写明了真实上限（常见于只开 32K 的推理服务）：
                        # 记下来，这一轮按它重新装配
                        await self._learn_window(header, attempt_route, limit)
                        attempt_route = with_model_window(attempt_route, limit)
                    window = attempt_route.window.effective_window
                    log.warning(
                        "turn.context_overflow_retry",
                        window=window,
                        learned_window=limit if learned else None,
                    )
                    try:
                        context = self._assembler_for(header).assemble(
                            ctx, window, budget=None if learned else overflow_retry_budget(window)
                        )
                    except ContextTooLarge as exc:
                        raise TurnFailed(failure_from_provider(error)) from exc
                    self._log_context(context, attempt_route)
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
                    prompts=self._prompts_for(header),
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
            raise self._narrative_missing(generation) from exc
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

    def _finalize_ending(self, generation: Generation, state_lag: bool) -> TurnOutcome:
        """结局：只要叙述，不补选项；模型照习惯写了选项也丢掉。"""
        parse = generation.parse
        if parse.stage is ParseStage.FAILED or not parse.narrative.strip():
            raise self._narrative_missing(generation)
        repairs = [r for r in parse.repairs if r != MISSING_OPTIONS]
        log.info(
            "director.parse",
            stage="ending",
            options=0,
            dropped_options=len(parse.options),
            repairs=repairs,
            notes=list(parse.notes)[:10],
            rewritten=parse.rewritten,
        )
        run = self._director_run(
            generation,
            status="ok",
            extra={"stage": "ending", "repairs": repairs, "notes": list(parse.notes)[:10]},
        )
        return TurnOutcome(
            narrative=parse.narrative,
            options=[],
            options_source=None,
            usage=generation.usage,
            state_lag=state_lag,
            runs=[run],
            ends_story=True,
        )

    def _narrative_missing(self, generation: Generation) -> TurnFailed:
        log.warning("director.parse", stage="narrative_missing")
        run = self._director_run(generation, status="failed", error_class="narrative_missing")
        return TurnFailed(
            TurnFailure(
                code="NARRATIVE_MISSING",
                message="The director didn't write anything this time, please try again",
                retryable=True,
                narrative=generation.streamed,
                partial=bool(generation.streamed),
                runs=[run],
            )
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
