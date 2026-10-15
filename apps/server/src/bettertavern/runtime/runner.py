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
    HOT_PATH,
    CancelToken,
    Done,
    ProviderError,
    ProviderHub,
    TextDelta,
    Usage,
    UsageEvent,
    stream_with_retry,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout

from .agents.director import AGENT as DIRECTOR_AGENT
from .agents.director import director_request
from .agents.options_repair import repair_options
from .agents.world_builder import build_seed, failure_run
from .context.assembler import AssembledContext, ContextAssembler, ContextTooLarge
from .events.buffer import EventBufferRegistry, EventStream, StreamClosed
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
from .protocol.director_parser import DirectorParse, DirectorStreamParser, ParseStage
from .protocol.repair import NarrativeMissing, finalize_director_output
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)

_STAGE_TO_SOURCE = {
    ParseStage.OK: OptionsSource.MODEL,
    ParseStage.SALVAGED: OptionsSource.MODEL,
    ParseStage.REPAIRED: OptionsSource.REPAIRED,
    ParseStage.FALLBACK: OptionsSource.FALLBACK,
}

# provider 错误类别 → 回合失败码与能否重试
_FAILURE_CODES: dict[ErrorClass, tuple[str, bool]] = {
    ErrorClass.AUTH: ("CREDENTIAL_INVALID", False),
    ErrorClass.BILLING: ("PROVIDER_ERROR", False),
    ErrorClass.MODEL_NOT_FOUND: ("MODEL_NOT_FOUND", False),
    ErrorClass.CONTENT_POLICY_BLOCKED: ("CONTENT_BLOCKED", False),
    ErrorClass.ENDPOINT_NOT_ALLOWED: ("ENDPOINT_NOT_ALLOWED", False),
    ErrorClass.FORMAT_ERROR: ("PROVIDER_ERROR", False),
    ErrorClass.UNSUPPORTED_FEATURE: ("PROVIDER_ERROR", False),
    ErrorClass.CONTEXT_OVERFLOW: ("CONTEXT_TOO_LARGE", False),
    ErrorClass.PAYLOAD_TOO_LARGE: ("CONTEXT_TOO_LARGE", False),
    ErrorClass.CANCELLED: ("CANCELLED", True),
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


@dataclass
class _Generation:
    """一次导演调用的流式结果。"""

    parse: DirectorParse
    streamed: str
    usage: Usage | None
    finish_reason: str | None
    ttft_ms: int | None
    route: ResolvedRoute
    context: AssembledContext
    latency_ms: int = 0
    fallback_used: bool = False


def failure_from_provider(error: ProviderError, narrative: str = "") -> TurnFailure:
    code, retryable = _FAILURE_CODES.get(error.error_class, ("PROVIDER_ERROR", True))
    if error.error_class not in _FAILURE_CODES:
        retryable = True  # 网络、限流、5xx 等：玩家点重试即可
    return TurnFailure(
        code=code,
        message=_friendly(error),
        retryable=retryable,
        partial=bool(narrative),
        narrative=narrative,
    )


def _friendly(error: ProviderError) -> str:
    messages = {
        ErrorClass.AUTH: "模型服务商拒绝了你的密钥，请检查设置里的 API Key",
        ErrorClass.BILLING: "模型服务商提示额度不足或欠费",
        ErrorClass.RATE_LIMIT: "请求太频繁，被模型服务商限流了，请稍后重试",
        ErrorClass.OVERLOADED: "模型服务暂时繁忙，请稍后重试",
        ErrorClass.MODEL_NOT_FOUND: "找不到这个模型，请检查模型名",
        ErrorClass.CONTENT_POLICY_BLOCKED: "这段内容被模型服务商的内容策略拦截了",
        ErrorClass.CONTEXT_OVERFLOW: "上下文超出了模型窗口，建议换更大窗口的模型",
        ErrorClass.STREAM_INTERRUPTED: "生成中途断开了",
        ErrorClass.CANCELLED: "生成已取消",
    }
    return messages.get(error.error_class, f"模型服务出错：{error.error_class.value}")


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
                await self._fail(header, stream, LEASE_LOST)
                return
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
                    "usage": _usage_json(outcome.usage),
                },
            )
        except TurnFailed as exc:
            await self._fail(header, stream, exc.failure)
        except ProviderError as exc:
            await self._fail(header, stream, failure_from_provider(exc))
        except asyncio.CancelledError:
            with contextlib.suppress(Exception):
                await asyncio.shield(
                    self._fail(
                        header,
                        stream,
                        TurnFailure(
                            code="CANCELLED", message="服务正在重启，请重试", retryable=True
                        ),
                    )
                )
            raise
        except Exception:
            log.exception("turn.crashed")
            await self._fail(
                header,
                stream,
                TurnFailure(code="INTERNAL_ERROR", message="服务端出错了，请重试", retryable=True),
            )
        finally:
            renewer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await renewer
            await stream.close()

    async def _publish(self, stream: EventStream, event: str, data: dict[str, Any]) -> None:
        with contextlib.suppress(StreamClosed):
            await stream.publish(event, data)

    async def _fail(self, header: TurnHeader, stream: EventStream, failure: TurnFailure) -> None:
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
    ) -> _Generation:
        try:
            context = self._assembler.assemble(ctx, route.window.effective_window)
        except ContextTooLarge as exc:
            raise TurnFailed(
                TurnFailure(code="CONTEXT_TOO_LARGE", message=str(exc), retryable=False)
            ) from exc
        attempt_route = route
        fallback_used = False
        overflow_retried = False
        while True:
            try:
                generation = await self._stream_director(attempt_route, context, stream, cancel)
                generation.fallback_used = fallback_used
                return generation
            except _StreamFailed as failed:
                error = failed.error
                if failed.streamed:
                    raise TurnFailed(failure_from_provider(error, failed.streamed)) from error
                if error.error_class is ErrorClass.CONTEXT_OVERFLOW and not overflow_retried:
                    overflow_retried = True
                    window = attempt_route.window.effective_window
                    try:
                        context = self._assembler.assemble(
                            ctx, window, budget=overflow_retry_budget(window)
                        )
                    except ContextTooLarge as exc:
                        raise TurnFailed(failure_from_provider(error)) from exc
                    continue
                fallback = attempt_route.fallback
                if fallback is not None and error.policy.fallback and not fallback_used:
                    fallback_used = True
                    attempt_route = fallback
                    try:
                        context = self._assembler.assemble(ctx, fallback.window.effective_window)
                    except ContextTooLarge as exc:
                        raise TurnFailed(failure_from_provider(error)) from exc
                    continue
                raise TurnFailed(failure_from_provider(error)) from error

    async def _stream_director(
        self,
        route: ResolvedRoute,
        context: AssembledContext,
        stream: EventStream,
        cancel: CancelToken,
    ) -> _Generation:
        adapter = self._hub.adapter(route.provider)
        request = director_request(context, route)
        parser = DirectorStreamParser()
        pending: list[str] = []
        streamed: list[str] = []
        usage: Usage | None = None
        finish_reason: str | None = None
        ttft_ms: int | None = None
        started = self._clock()
        last_flush = started
        narrative_done = False

        async def flush() -> None:
            nonlocal last_flush
            if pending:
                text = "".join(pending)
                pending.clear()
                streamed.append(text)
                await self._publish(stream, "narrative.delta", {"text": text})
            last_flush = self._clock()

        try:
            async with self._hub.limiter.slot(
                route.credential.credential_id,
                interactive=True,
                timeout=self.config.limiter_timeout_s,
            ):
                async for event in stream_with_retry(
                    lambda: adapter.stream(request, route.credential, route.caps, cancel=cancel),
                    HOT_PATH,
                ):
                    if isinstance(event, TextDelta):
                        if ttft_ms is None:
                            ttft_ms = int((self._clock() - started) * 1000)
                        pending.extend(parser.feed(event.text))
                        if pending and self._clock() - last_flush >= self.config.delta_batch_s:
                            await flush()
                        if parser.narrative_closed and not narrative_done:
                            await flush()
                            narrative_done = True
                            await self._publish(
                                stream, "narrative.done", {"chars": len("".join(streamed))}
                            )
                    elif isinstance(event, UsageEvent):
                        usage = event.usage
                    elif isinstance(event, Done):
                        finish_reason = event.finish_reason
        except LimiterTimeout as exc:
            raise _StreamFailed(
                ProviderError(ErrorClass.RATE_LIMIT, "等待模型并发槽位超时"), ""
            ) from exc
        except ProviderError as exc:
            await flush()
            raise _StreamFailed(exc, "".join(streamed)) from exc
        tail, parse = parser.finish()
        pending.extend(tail)
        await flush()
        if not narrative_done:
            await self._publish(
                stream,
                "narrative.done",
                {"chars": len(parse.narrative), "rewritten": parse.rewritten},
            )
        return _Generation(
            parse=parse,
            streamed="".join(streamed),
            usage=usage,
            finish_reason=finish_reason,
            ttft_ms=ttft_ms,
            route=route,
            context=context,
            latency_ms=self._elapsed_ms(started),
        )

    async def _finalize(
        self, header: TurnHeader, generation: _Generation, state_lag: bool
    ) -> TurnOutcome:
        route = generation.route

        async def repair(narrative: str, existing: Any) -> list[str]:
            # 修复用 repair 路由（没配置就沿用导演路由），只在确实缺选项时才解析
            target = (
                await self._routes.resolve(header.user_id, RouteTask.REPAIR, header.playthrough_id)
                or route
            )
            return await repair_options(
                self._hub.adapter(target.provider),
                target.credential,
                target.caps,
                model=target.model,
                prompts=self._prompts,
                narrative=narrative,
                existing=list(existing),
                max_tokens=target.params.max_tokens_for(RouteTask.REPAIR),
            )

        try:
            outcome = await finalize_director_output(
                generation.parse,
                repair=repair,
                fallback=fallback_options(header.language),
                timeout=self.config.options_repair_timeout_s,
            )
        except NarrativeMissing as exc:
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

    def _director_run(
        self,
        generation: _Generation,
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


class _StreamFailed(Exception):
    def __init__(self, error: ProviderError, streamed: str) -> None:
        super().__init__(error.message)
        self.error = error
        self.streamed = streamed


def _usage_json(usage: Usage | None) -> dict[str, int] | None:
    if usage is None:
        return None
    return {
        "prompt": usage.prompt,
        "completion": usage.completion,
        "cached": usage.cached,
        "reasoning": usage.reasoning,
    }


class TurnRunnerPool:
    """进程内的回合执行器：每个回合一个后台任务，持有它的事件流与取消令牌。"""

    def __init__(self, runner: TurnRunner, buffers: EventBufferRegistry) -> None:
        self._runner = runner
        self._buffers = buffers
        self._running: dict[str, tuple[asyncio.Task[None], CancelToken]] = {}

    def start(self, header: TurnHeader) -> EventStream:
        """同步创建事件流（返回 201 之前），客户端随后订阅一定能找到它。"""
        stream = self._buffers.create(header.turn_id)
        token = CancelToken()
        task = asyncio.create_task(self._runner.run(header, stream, token))
        self._running[header.turn_id] = (task, token)
        task.add_done_callback(lambda _t, tid=header.turn_id: self._running.pop(tid, None))
        return stream

    def is_running(self, turn_id: str) -> bool:
        return turn_id in self._running

    def cancel(self, turn_id: str, reason: str = "user") -> bool:
        entry = self._running.get(turn_id)
        if entry is None:
            return False
        entry[1].cancel(reason)
        return True

    def __len__(self) -> int:
        return len(self._running)

    async def shutdown(self, grace: float) -> None:
        """优雅退出：先等进行中的回合最多 grace 秒，再取消剩下的（回合置为失败，可重试）。"""
        tasks = [task for task, _ in self._running.values()]
        if not tasks:
            return
        _, pending = await asyncio.wait(tasks, timeout=grace)
        for task, token in list(self._running.values()):
            if task in pending:
                token.cancel("shutdown")
        if pending:
            _, still = await asyncio.wait(pending, timeout=5.0)
            for task in still:
                task.cancel()
            if still:
                await asyncio.wait(still, timeout=2.0)
