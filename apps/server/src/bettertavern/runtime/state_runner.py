"""后台整理世界状态（docs/agent-runtime.md 第 3 节“后台”、第 4 节“世界状态 agent”）。

worker 领到一局的 state 任务后调用 process()：从“已整理到的回合 + 1”开始，一回合一回合往后整理，
直到这条故事线上还没写完或已经整理完的地方。

- 整理成功：在一个事务里写入（StateStore.commit）。写入时整理进度或时间线编号对不上（期间回退过），
  整次结果作废，停下来，回退后放进来的新任务会接着整理。
- 整理失败（调模型出错、超时、模型没用 commit 结束）：记一次失败就停下，不单独重试，下一回合的
  任务会再从这一回合开始；同一回合失败满 max_failures 次就跳过它，接着整理后面的回合。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.providers import ProviderError, ProviderHub, Usage

from .agent import AgentStep, StepLog
from .agents.state_keeper import AGENT, NoCommit, keep_state
from .ports import AgentRunRecord, RouteResolver, StateCommit, StateStore, StateTurn
from .prompts import PromptBook
from .routing import ResolvedRoute

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class StateRunnerConfig:
    turn_timeout_s: float = 180.0  # 整理一回合最多多久，超时算失败
    max_failures: int = 2  # 同一回合失败几次后跳过


def _total_usage(steps: Sequence[AgentStep]) -> Usage | None:
    usages = [s.usage for s in steps if s.usage is not None]
    if not usages:
        return None
    return Usage(
        prompt=sum(u.prompt for u in usages),
        completion=sum(u.completion for u in usages),
        cached=sum(u.cached for u in usages),
        reasoning=sum(u.reasoning for u in usages),
    )


class StateRunner:
    def __init__(
        self,
        *,
        store: StateStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        config: StateRunnerConfig | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self.config = config or StateRunnerConfig()
        self._clock = clock

    async def process(self, playthrough_id: str) -> int:
        """整理这一局还没整理的回合，返回这次整理（包括跳过）了几回合。"""
        done = 0
        while True:
            turn = await self._store.next_turn(playthrough_id)
            if turn is None:
                return done
            outcome = await self._run(turn)
            if isinstance(outcome, StateCommit):
                if not await self._store.commit(turn, outcome):
                    log.info("state.stale", playthrough_id=playthrough_id, seq=turn.seq)
                    return done
                done += 1
                continue
            if turn.failures + 1 >= self.config.max_failures:
                skipped = await self._store.skip(turn, outcome)
                log.warning(
                    "state.skipped",
                    playthrough_id=playthrough_id,
                    seq=turn.seq,
                    error_class=outcome.error_class,
                )
                if not skipped:
                    return done
                done += 1
                continue
            await self._store.fail(turn, outcome)
            return done

    async def _run(self, turn: StateTurn) -> StateCommit | AgentRunRecord:
        started = self._clock()
        structlog.contextvars.bind_contextvars(
            turn_id=turn.turn_id, playthrough_id=turn.playthrough_id
        )
        try:
            route = await self._routes.resolve(
                turn.user_id, RouteTask.STATE_KEEPER, turn.playthrough_id
            )
            if route is None:
                return self._failed(turn, None, StepLog(), "route_missing", started)
            if not route.caps.tools:
                return self._failed(turn, route, StepLog(), "tools_unsupported", started)
            steps = StepLog()
            refs: dict[str, str] = {}
            prompts = self._prompts.get(turn.language)
            try:
                async with asyncio.timeout(self.config.turn_timeout_s):
                    kept = await keep_state(
                        self._hub.adapter(route.provider),
                        route,
                        turn,
                        prompts,
                        steps=steps,
                        refs=refs,
                    )
            except TimeoutError:
                return self._failed(turn, route, steps, "timeout", started, refs)
            except ProviderError as exc:
                return self._failed(turn, route, steps, exc.error_class.value, started, refs)
            except NoCommit:
                return self._failed(turn, route, steps, "no_commit", started, refs)
            result = kept.result
            log.info(
                "state.kept",
                seq=turn.seq,
                changes=len(result.changes),
                rejected=len(kept.rejected),
                model_calls=kept.model_calls,
                scene_ended=result.scene_ended,
                duration_ms=self._elapsed_ms(started),
            )
            run = AgentRunRecord(
                agent=AGENT,
                task=RouteTask.STATE_KEEPER.value,
                status="ok",
                provider=route.provider,
                model=route.model,
                usage=_total_usage(steps.steps),
                latency_ms=self._elapsed_ms(started),
                result={
                    "changes": len(result.changes),
                    "rejected": [dict(r) for r in kept.rejected],
                    "model_calls": kept.model_calls,
                    "scene_ended": result.scene_ended,
                    "refs": refs,
                },
                steps=steps.steps,
            )
            return StateCommit(
                changes=result.changes,
                digest=result.digest,
                entity_ids=result.entity_ids,
                scene_ended=result.scene_ended,
                run=run,
            )
        finally:
            structlog.contextvars.unbind_contextvars("turn_id", "playthrough_id")

    def _failed(
        self,
        turn: StateTurn,
        route: ResolvedRoute | None,
        steps: StepLog,
        error_class: str,
        started: float,
        refs: dict[str, str] | None = None,
    ) -> AgentRunRecord:
        log.warning(
            "state.failed",
            seq=turn.seq,
            error_class=error_class,
            failures=turn.failures + 1,
            duration_ms=self._elapsed_ms(started),
        )
        return AgentRunRecord(
            agent=AGENT,
            task=RouteTask.STATE_KEEPER.value,
            status="failed",
            provider=route.provider if route is not None else None,
            model=route.model if route is not None else None,
            usage=_total_usage(steps.steps),
            latency_ms=self._elapsed_ms(started),
            error_class=error_class,
            result={"attempt": turn.failures + 1, **({"refs": refs} if refs else {})},
            steps=steps.steps,
        )

    def _elapsed_ms(self, started: float) -> int:
        return int((self._clock() - started) * 1000)
