"""闪电模式的后台压缩（docs/agent-runtime.md 的“闪电模式”）。

worker 领到一局的压缩任务后调用 process()：看梗概之后的原文够不够压
（domain/memory/lightning.py），不够就结束，不调模型；够就用导演的模型把旧梗概和较早的
一段原文合成新的一版梗概（runtime/agents/compressor.py），最近一段原文留着。

- 写成：在一个事务里写入（LightningStore.commit）。覆盖进度或时间线编号对不上
  （期间回退过、已经压过），这次结果作废。
- 写失败（调模型出错、超时、没写出梗概）：记一次失败就停下。下一回合存好时会再放一个任务，
  所以会再试；一直失败时原文越积越长，由紧急截断兜着（runtime/context/assembler.py）。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

import structlog

from bettertavern.domain.memory.lightning import (
    LIGHTNING_COMPRESS_TOKENS,
    LIGHTNING_KEEP_TOKENS,
    LIGHTNING_KEEP_TURNS,
    RawTurn,
    compress_end,
    compress_threshold,
)
from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ProviderError, ProviderHub
from bettertavern.providers.limiter import LimiterTimeout

from .agent import StepLog
from .agents.compressor import AGENT, EmptySynopsis, compress
from .context.tokens import estimate_tokens
from .ports import (
    AgentRunRecord,
    CompressCommit,
    CompressWork,
    HistoryTurn,
    LightningStore,
    RouteResolver,
)
from .prompts import PromptBook
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)

# 一回合原文里除了行动和叙述，还有标签、选项这些，按固定的数加上
TURN_OVERHEAD_TOKENS = 40


@dataclass(frozen=True)
class LightningRunnerConfig:
    compress_tokens: int = LIGHTNING_COMPRESS_TOKENS
    keep_tokens: int = LIGHTNING_KEEP_TOKENS
    keep_turns: int = LIGHTNING_KEEP_TURNS
    timeout_s: float = 180.0  # 压一次最多多久，超时算失败


def turn_tokens(turn: HistoryTurn) -> int:
    return (
        estimate_tokens(turn.action.text or "")
        + estimate_tokens(turn.narrative)
        + sum(estimate_tokens(option) for option in turn.options)
        + TURN_OVERHEAD_TOKENS
    )


class LightningRunner:
    def __init__(
        self,
        *,
        store: LightningStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        config: LightningRunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self.config = config or LightningRunnerConfig()
        self._clock = clock

    async def process(self, playthrough_id: str) -> bool:
        """够压就压一次，返回这次有没有写出新梗概。"""
        work = await self._store.pending(playthrough_id)
        if work is None or not work.context.history:
            return False
        structlog.contextvars.bind_contextvars(playthrough_id=playthrough_id)
        try:
            # 用导演的模型：压缩请求的开头和导演的请求一样，才能命中前缀缓存
            route = await self._routes.resolve(work.user_id, RouteTask.DIRECTOR, playthrough_id)
            if route is None:
                return False  # 没有导演的模型就玩不下去，也不用压
            window = route.window.effective_window
            sizes = [RawTurn(t.seq, turn_tokens(t)) for t in work.context.history]
            last_seq = compress_end(
                sizes,
                compress_threshold(window, self.config.compress_tokens),
                keep_tokens=self.config.keep_tokens,
                keep_turns=self.config.keep_turns,
            )
            if last_seq is None:
                return False
            outcome = await self._run(work, route, window, last_seq)
            if isinstance(outcome, CompressCommit):
                if not await self._store.commit(work, outcome):
                    log.info("lightning.stale", last_seq=last_seq)
                    return False
                return True
            await self._store.fail(work, outcome)
            return False
        finally:
            structlog.contextvars.unbind_contextvars("playthrough_id")

    async def _run(
        self, work: CompressWork, route: ResolvedRoute, window: int, last_seq: int
    ) -> CompressCommit | AgentRunRecord:
        started = self._clock()
        first_seq = work.context.history[0].seq
        steps = StepLog()
        prompts = self._prompts.get(work.context.header.language)
        try:
            async with asyncio.timeout(self.config.timeout_s):
                written = await compress(
                    route,
                    self._hub.adapter(route.provider),
                    work.context,
                    last_seq,
                    prompts,
                    window=window,
                    steps=steps,
                    negative_cache=self._hub.negative_cache,
                )
        except TimeoutError:
            return self._failed(route, steps, "timeout", started, first_seq, last_seq)
        except ProviderError as exc:
            return self._failed(route, steps, exc.error_class.value, started, first_seq, last_seq)
        except (EmptySynopsis, LimiterTimeout) as exc:
            return self._failed(route, steps, type(exc).__name__, started, first_seq, last_seq)
        usage = steps.total_usage()
        log.info(
            "lightning.compressed",
            first_seq=first_seq,
            last_seq=last_seq,
            synopsis_chars=len(written.synopsis),
            truncated=written.truncated,
            prompt_tokens=usage.prompt if usage else None,
            cached_tokens=usage.cached if usage else None,
            duration_ms=self._elapsed_ms(started),
        )
        run = AgentRunRecord(
            agent=AGENT,
            task=RouteTask.DIRECTOR.value,
            status="ok",
            provider=route.provider,
            model=route.model,
            prices=route.prices,
            prompt_hash=written.prompt_hash,
            usage=usage,
            latency_ms=self._elapsed_ms(started),
            result={
                "first_seq": first_seq,
                "last_seq": last_seq,
                "synopsis_chars": len(written.synopsis),
                "truncated": written.truncated,
            },
            steps=steps.steps,
        )
        return CompressCommit(
            first_seq=first_seq, last_seq=last_seq, synopsis=written.synopsis, run=run
        )

    def _failed(
        self,
        route: ResolvedRoute,
        steps: StepLog,
        error_class: str,
        started: float,
        first_seq: int,
        last_seq: int,
    ) -> AgentRunRecord:
        log.warning(
            "lightning.failed",
            first_seq=first_seq,
            last_seq=last_seq,
            error_class=error_class,
            duration_ms=self._elapsed_ms(started),
        )
        return AgentRunRecord(
            agent=AGENT,
            task=RouteTask.DIRECTOR.value,
            status="failed",
            provider=route.provider,
            model=route.model,
            prices=route.prices,
            usage=steps.total_usage(),
            latency_ms=self._elapsed_ms(started),
            error_class=error_class,
            result={"first_seq": first_seq, "last_seq": last_seq},
            steps=steps.steps,
        )

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
