"""后台章节整理（docs/agent-runtime.md 第 3 节“后台”、第 4 节“章节整理”）。

worker 领到一局的 memory 任务后调用 process()：看章节摘要覆盖到的回合之后、已经整理进世界状态的
回合够不够切一章（domain/memory/chapters.py），够就写这一章，再看下一章，直到不够为止。

- 写成：在一个事务里写入（MemoryStore.commit）。写入时覆盖进度或时间线编号对不上（期间回退过），
  整次结果作废，停下来。
- 写失败（调模型出错、超时、格式一直不对）：记一次失败就停下。不跳过：跳过的回合就没有摘要了。
  世界状态 agent 每整理完一回合都会再放一个任务，所以下一回合会再试；一直失败时原文越积越长，
  由紧急截断兜着（runtime/context/assembler.py）。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import structlog

from bettertavern.domain.memory.chapters import ChapterRule, TurnSize, chapter_end
from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ProviderError, ProviderHub
from bettertavern.providers.limiter import LimiterTimeout

from .agent import StepLog
from .agents.chapter_writer import AGENT, write_chapter
from .context.tokens import estimate_tokens
from .ports import (
    AgentRunRecord,
    ChapterCommit,
    ChapterTurn,
    MemoryStore,
    MemoryWork,
    RouteResolver,
)
from .prompts import PromptBook
from .protocol.structured import StructuredOutputError
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)

# 一回合原文里除了行动和叙述，还有标签、选项这些，按固定的数加上
TURN_OVERHEAD_TOKENS = 40


@dataclass(frozen=True)
class MemoryRunnerConfig:
    rule: ChapterRule = field(default_factory=ChapterRule)
    timeout_s: float = 180.0  # 写一章最多多久，超时算失败


def turn_tokens(turn: ChapterTurn) -> int:
    return (
        estimate_tokens(turn.action.text or "")
        + estimate_tokens(turn.narrative)
        + (TURN_OVERHEAD_TOKENS)
    )


class MemoryRunner:
    def __init__(
        self,
        *,
        store: MemoryStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        config: MemoryRunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self.config = config or MemoryRunnerConfig()
        self._clock = clock

    async def process(self, playthrough_id: str) -> int:
        """把这一局够切的章节都写完，返回这次写了几章。"""
        done = 0
        while True:
            work = await self._store.pending(playthrough_id)
            if work is None:
                return done
            sizes = [TurnSize(t.seq, turn_tokens(t), t.scene_ended) for t in work.turns]
            last_seq = chapter_end(sizes, self.config.rule)
            if last_seq is None:
                return done
            outcome = await self._run(work, last_seq)
            if isinstance(outcome, ChapterCommit):
                if not await self._store.commit(work, outcome):
                    log.info("memory.stale", playthrough_id=playthrough_id, last_seq=last_seq)
                    return done
                done += 1
                continue
            await self._store.fail(work, outcome)
            return done

    async def _run(self, work: MemoryWork, last_seq: int) -> ChapterCommit | AgentRunRecord:
        started = self._clock()
        first_seq = work.turns[0].seq
        structlog.contextvars.bind_contextvars(playthrough_id=work.playthrough_id)
        try:
            route = await self._routes.resolve(
                work.user_id, RouteTask.COMPACTOR, work.playthrough_id
            )
            steps = StepLog()
            if route is None:
                return self._failed(work, None, steps, "route_missing", started, last_seq)
            try:
                async with asyncio.timeout(self.config.timeout_s):
                    written = await write_chapter(
                        route,
                        self._hub.adapter(route.provider),
                        work,
                        last_seq,
                        self._prompts.get(work.language),
                        steps=steps,
                        negative_cache=self._hub.negative_cache,
                    )
            except TimeoutError:
                return self._failed(work, route, steps, "timeout", started, last_seq)
            except ProviderError as exc:
                return self._failed(work, route, steps, exc.error_class.value, started, last_seq)
            except (StructuredOutputError, LimiterTimeout) as exc:
                return self._failed(work, route, steps, type(exc).__name__, started, last_seq)
            folded = written.folded
            log.info(
                "memory.chapter",
                first_seq=first_seq,
                last_seq=last_seq,
                turns=sum(1 for t in work.turns if t.seq <= last_seq),
                chapter_chars=len(written.chapter),
                folded_last_seq=folded.last_seq if folded else None,
                duration_ms=self._elapsed_ms(started),
            )
            run = AgentRunRecord(
                agent=AGENT,
                task=RouteTask.COMPACTOR.value,
                status="ok",
                provider=route.provider,
                model=route.model,
                prompt_hash=written.prompt_hash,
                usage=steps.total_usage(),
                latency_ms=self._elapsed_ms(started),
                result={
                    "first_seq": first_seq,
                    "last_seq": last_seq,
                    "mode": written.structured.mode,
                    "attempts": written.structured.attempts,
                    "chapter_chars": len(written.chapter),
                    "profile_chars": len(written.profile),
                    "folded_last_seq": folded.last_seq if folded else None,
                },
                steps=steps.steps,
            )
            return ChapterCommit(
                first_seq=first_seq,
                last_seq=last_seq,
                chapter=written.chapter,
                profile=written.profile,
                run=run,
                synopsis=written.synopsis,
                synopsis_last_seq=folded.last_seq if folded else None,
            )
        finally:
            structlog.contextvars.unbind_contextvars("playthrough_id")

    def _failed(
        self,
        work: MemoryWork,
        route: ResolvedRoute | None,
        steps: StepLog,
        error_class: str,
        started: float,
        last_seq: int,
    ) -> AgentRunRecord:
        log.warning(
            "memory.failed",
            first_seq=work.turns[0].seq,
            last_seq=last_seq,
            error_class=error_class,
            duration_ms=self._elapsed_ms(started),
        )
        return AgentRunRecord(
            agent=AGENT,
            task=RouteTask.COMPACTOR.value,
            status="failed",
            provider=route.provider if route is not None else None,
            model=route.model if route is not None else None,
            usage=steps.total_usage(),
            latency_ms=self._elapsed_ms(started),
            error_class=error_class,
            result={"first_seq": work.turns[0].seq, "last_seq": last_seq},
            steps=steps.steps,
        )

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
