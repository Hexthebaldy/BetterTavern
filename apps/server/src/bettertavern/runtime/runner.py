"""TurnRunner：一个回合的热路径执行器（api 进程内，生成与客户端连接解耦）。

步骤：（开场且世界未建好时）WorldBuilder → 装配上下文 → 导演流式生成（边收边解析，
叙述增量合并成至少 40 毫秒一批发出；有不在上下文里的旧回合时可以先用召回工具查，见
director_loop.py）→ 修复阶梯 → 一个事务提交 → options.ready、turn.completed。
结局那一轮（行动来源 ending）只要叙述：不走修复阶梯，模型写了选项也丢掉，提交时把这局标为已完结。

- 生成期间每 30 秒续租；续租失败（租约被清理或发生了回退）就取消生成，不再写库；
- 调模型出错不自动重试、也不换别的模型，这一轮直接失败（玩家自己点重试）；
  已经写出的半截叙述存为草稿；
- 唯一的例外是厂商报超窗：说明我们估算的 token 数偏少或窗口记大了，
  重新装配到有效窗口的 85% 以内再发一次；
- 玩家取消、进程关闭都通过 CancelToken 关闭上游连接，回合置为 failed。

提交后回合是 replied，世界状态由后台的世界状态 agent 整理（runtime/state_runner.py）。
下一回合不等它：状态块开头写明截至第几回合，之后的变化以上下文里的原文为准
（docs/agent-runtime.md 第 3 节）。

闪电模式（header.mode，docs/agent-runtime.md 的“闪电模式”）：开局、导演都和普通模式一样，
只是提交后回合直接是 committed，不整理世界状态。开局时存下卡的原文，导演的系统提示里放它。
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.domain.memory.thresholds import overflow_retry_budget
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.mode import is_lightning
from bettertavern.domain.world.card_source import CardSource, snapshot_cards
from bettertavern.domain.world.lore import LoreSnapshot, build_snapshot
from bettertavern.domain.world.seed import ProtagonistSeed, Seed, minimal_seed
from bettertavern.providers import (
    CancelToken,
    ProviderError,
    ProviderHub,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout

from .agent import StepLog
from .agents.director_tools import RecallContext
from .agents.world_builder import build_seed, failure_run
from .context.assembler import AssembledContext, ContextAssembler, ContextTooLarge
from .context.lore import LoreSelection, scan_of, select_lore
from .director_loop import run_director
from .events.buffer import EventStream, StreamClosed
from .ports import (
    AgentRunRecord,
    RecallStore,
    RouteResolver,
    TurnContext,
    TurnFailure,
    TurnHeader,
    TurnOutcome,
    TurnStore,
    WorldBuildInput,
)
from .prompts import PromptBook, PromptLibrary
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute, with_model_window
from .runner_pool import TurnRunnerPool
from .turn_finalize import (
    TurnFailed,
    failed_director_run,
    finalize_ending,
    finalize_greeting,
    finalize_turn,
)
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


@dataclass(frozen=True)
class RunnerConfig:
    lease_ttl_s: float = 120.0
    lease_renew_s: float = 30.0
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
        recall: RecallStore | None = None,
    ) -> None:
        """recall 不给时导演没有召回工具，只靠拼好的上下文写。"""
        self._store = store
        self._recall = recall
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
                state_seq=outcome.state_seq,
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
                        "status": (
                            "committed"
                            if outcome.ends_story or is_lightning(header.mode)
                            else "replied"
                        ),
                        "narrative": outcome.narrative,
                        "options": [o.to_json() for o in outcome.options],
                        "options_source": outcome.options_source,
                        "state_seq": outcome.state_seq,
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
        if ctx.action.source == "opening" and ctx.opening_greeting:
            # 剧本设置里选了卡片的开场白：开场就用它，不让导演重写，只补选项
            await self._publish(stream, "narrative.delta", {"text": ctx.opening_greeting})
            await self._publish(stream, "narrative.done", {"chars": len(ctx.opening_greeting)})
            log.info("turn.greeting_opening", chars=len(ctx.opening_greeting))
            return await finalize_greeting(
                header,
                ctx.opening_greeting,
                route,
                ctx.state_seq,
                routes=self._routes,
                hub=self._hub,
                prompts=self._prompts_for(header),
                clock=self._clock,
                repair_timeout_s=self.config.options_repair_timeout_s,
            )
        generation = await self._generate(header, ctx, route, stream, cancel)
        if ctx.action.source == "ending":
            return finalize_ending(generation, ctx.state_seq)
        return await finalize_turn(
            header,
            generation,
            ctx.state_seq,
            routes=self._routes,
            hub=self._hub,
            prompts=self._prompts_for(header),
            clock=self._clock,
            repair_timeout_s=self.config.options_repair_timeout_s,
        )

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
        steps = StepLog()
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
                            steps=steps,
                        )
                seed, source, run = result.seed, "world_builder", result.run
            except TimeoutError:
                run = failure_run(
                    route, "timeout", "WorldBuilder timed out", self._elapsed_ms(started), steps
                )
            except ProviderError as exc:
                if exc.error_class is ErrorClass.CANCELLED:
                    raise
                run = failure_run(
                    route, exc.error_class.value, exc.message, self._elapsed_ms(started), steps
                )
            except (StructuredOutputError, LimiterTimeout) as exc:
                run = failure_run(
                    route, type(exc).__name__, str(exc), self._elapsed_ms(started), steps
                )
        cancel.raise_if_cancelled()
        if seed is None:
            if inp.card is not None:
                seed = minimal_seed(
                    inp.card,
                    protagonist_name=inp.protagonist_name,
                    protagonist_summary=inp.protagonist_summary,
                    others=inp.cards[1:],
                )
            else:
                seed = Seed(
                    protagonist=ProtagonistSeed(
                        name=inp.protagonist_name, summary=inp.protagonist_summary
                    )
                )
        cards = self._card_source(inp)
        lore = self._lore(inp)
        count = await self._store.save_world(header, seed, source, run, cards, lore)
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

    def _card_source(self, inp: WorldBuildInput) -> CardSource | None:
        """卡的原文快照：闪电模式放进导演的系统提示（docs/agent-runtime.md 的“闪电模式”）。
        卡里的世界书不放进来，和挂的世界书一起走世界书快照（_lore）。"""
        if not inp.cards:
            return None
        cards = snapshot_cards(inp.cards, protagonist_name=inp.protagonist_name, lore=False)
        if cards.truncated:
            log.warning("world.cards_truncated", cards=len(cards.cards), chars=cards.chars())
        return cards

    def _lore(self, inp: WorldBuildInput) -> LoreSnapshot:
        """这一局的世界书快照（docs/lorebook.md 第 3.2 节）：几张卡自带的和剧本挂的合成一份。
        没有世界书也存一份空的，表示这一局是世界书功能上线以后开的。"""
        lore = build_snapshot(
            inp.cards,
            inp.lorebooks,
            protagonist_name=inp.protagonist_name,
            protagonist_summary=inp.protagonist_summary,
        )
        log.info(
            "world.lore_built",
            books=len(lore.books),
            entries=len(lore.items),
            constant=sum(1 for i in lore.items if i.entry.constant),
            dropped=lore.dropped,
        )
        if lore.dropped:
            log.warning("world.lore_truncated", dropped=lore.dropped, chars=lore.chars())
        return lore

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
            context = await self._assemble(header, ctx, route, route.window.effective_window)
        except ContextTooLarge as exc:
            raise TurnFailed(
                TurnFailure(code="CONTEXT_TOO_LARGE", message=str(exc), retryable=False)
            ) from exc
        self._log_context(context, route)
        # 同一回合里超窗后重新装配再请求，也记在同一次运行里
        steps = StepLog()
        attempt_route = route
        overflow_retried = False
        while True:
            try:
                generation = await self._call_director(
                    header, ctx, attempt_route, context, stream, cancel, steps
                )
                generation.steps = steps.steps
                return generation
            except GenerationLimitHit as hit:
                failure = hit.failure
                run = failed_director_run(attempt_route, context, steps, failure.code.lower())
                raise TurnFailed(dataclasses.replace(failure, runs=[run])) from hit
            except StreamFailed as failed:
                error = failed.error
                run = failed_director_run(attempt_route, context, steps, error.error_class.value)
                if failed.streamed:
                    failure = failure_from_provider(error, failed.streamed)
                    raise TurnFailed(dataclasses.replace(failure, runs=[run])) from error
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
                        context = await self._assemble(
                            header,
                            ctx,
                            attempt_route,
                            window,
                            budget=None if learned else overflow_retry_budget(window),
                        )
                    except ContextTooLarge as exc:
                        failure = failure_from_provider(error)
                        raise TurnFailed(dataclasses.replace(failure, runs=[run])) from exc
                    self._log_context(context, attempt_route)
                    continue
                failure = failure_from_provider(error)
                raise TurnFailed(dataclasses.replace(failure, runs=[run])) from error

    def _offers_recall(self, route: ResolvedRoute) -> bool:
        return self._recall is not None and route.caps.tools

    async def _assemble(
        self,
        header: TurnHeader,
        ctx: TurnContext,
        route: ResolvedRoute,
        window: int,
        *,
        budget: int | None = None,
    ) -> AssembledContext:
        lore: LoreSelection | None = None
        if ctx.lore is not None and ctx.lore.items:
            # 挑世界书条目可能要跑用户写的正则（有超时）：放到线程里，不占事件循环
            lore = await asyncio.to_thread(select_lore, ctx.lore, scan_of(ctx), window=window)
            log.info(
                "turn.lore",
                constant=lore.stats.get("constant", 0),
                triggered=len(lore.triggered),
                recursion=lore.stats.get("recursion", 0),
                dropped=lore.stats.get("dropped", 0),
                regex_timeouts=lore.stats.get("regex_timeouts", 0),
            )
        return self._assembler_for(header).assemble(
            ctx,
            window,
            budget=budget,
            recall=self._offers_recall(route),
            lore=lore,
        )

    async def _call_director(
        self,
        header: TurnHeader,
        ctx: TurnContext,
        route: ResolvedRoute,
        context: AssembledContext,
        stream: EventStream,
        cancel: CancelToken,
        steps: StepLog,
    ) -> Generation:
        """导演走执行循环：有不在上下文里的旧回合时提供召回工具（director_loop.py）。"""
        prompts = self._prompts_for(header)
        recall: RecallContext | None = None
        if self._recall is not None and self._offers_recall(route) and context.recall_before > 0:
            recall = RecallContext(
                store=self._recall,
                playthrough_id=header.playthrough_id,
                seq=header.seq,
                before_seq=context.recall_before,
                messages=prompts.data("recall"),
            )
        return await run_director(
            self._streamer,
            route,
            context,
            lambda event, data: self._publish(stream, event, data),
            cancel,
            steps=steps,
            prompts=prompts,
            recall=recall,
            clock=self._clock,
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
