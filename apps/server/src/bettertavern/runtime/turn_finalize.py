"""一回合的收尾（TurnRunner 用）：普通回合按修复阶梯补选项、结局只要叙述，
并且把导演这次运行记成 agent_runs 的一行（成功、失败都记，带上每一步）。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.turn import OptionsSource, make_options
from bettertavern.providers import ProviderHub
from bettertavern.providers.errors import ErrorClass

from .agent import StepLog
from .agents.director import AGENT as DIRECTOR_AGENT
from .agents.options_repair import AGENT as OPTIONS_REPAIR_AGENT
from .agents.options_repair import repair_options
from .context.assembler import AssembledContext
from .ports import AgentRunRecord, RouteResolver, TurnFailure, TurnHeader, TurnOutcome
from .prompts import PromptLibrary
from .protocol.director_parser import MISSING_OPTIONS, DirectorParse, ParseStage
from .protocol.repair import NarrativeMissing, finalize_director_output
from .routing import ResolvedRoute
from .turn_stream import Generation

log = structlog.get_logger(__name__)

_STAGE_TO_SOURCE = {
    ParseStage.OK: OptionsSource.MODEL,
    ParseStage.SALVAGED: OptionsSource.MODEL,
    ParseStage.REPAIRED: OptionsSource.REPAIRED,
    ParseStage.MISSING: OptionsSource.MISSING,
}


class TurnFailed(Exception):
    def __init__(self, failure: TurnFailure) -> None:
        super().__init__(failure.message)
        self.failure = failure


def failed_director_run(
    route: ResolvedRoute, context: AssembledContext, steps: StepLog, error_class: str
) -> AgentRunRecord:
    """导演这次没写成：照样记一行 agent_runs，带上已经发生的步骤，方便查问题。"""
    return AgentRunRecord(
        agent=DIRECTOR_AGENT,
        task=RouteTask.DIRECTOR.value,
        status="cancelled" if error_class == ErrorClass.CANCELLED.value else "failed",
        provider=route.provider,
        model=route.model,
        prompt_hash=context.fingerprint,
        error_class=error_class,
        result=context_result(route, context),
        steps=steps.steps,
    )


def _repairer(
    header: TurnHeader,
    route: ResolvedRoute,
    *,
    routes: RouteResolver,
    hub: ProviderHub,
    prompts: PromptLibrary,
    clock: Callable[[], float],
    repair_runs: list[AgentRunRecord],
) -> Callable[[str, Any], Awaitable[list[str]]]:
    """补选项的函数：每补一次记一行 agent_runs（放进 repair_runs）。"""

    async def repair(narrative: str, existing: Any) -> list[str]:
        # 修复用 repair 路由（没配置就沿用导演路由），只在确实缺选项时才解析
        target = (
            await routes.resolve(header.user_id, RouteTask.REPAIR, header.playthrough_id) or route
        )
        repair_started = clock()
        steps = StepLog()

        def record(
            status: Literal["ok", "failed", "cancelled"],
            error_class: str | None,
            produced: int,
        ) -> None:
            step_usage = [s.usage for s in steps.steps if s.usage is not None]
            repair_runs.append(
                AgentRunRecord(
                    agent=OPTIONS_REPAIR_AGENT,
                    task=RouteTask.REPAIR.value,
                    status=status,
                    provider=target.provider,
                    model=target.model,
                    usage=step_usage[-1] if step_usage else None,
                    latency_ms=int((clock() - repair_started) * 1000),
                    error_class=error_class,
                    result={"existing": len(list(existing)), "produced": produced},
                    steps=steps.steps,
                )
            )

        try:
            options = await repair_options(
                hub.adapter(target.provider),
                target.credential,
                target.caps,
                model=target.model,
                prompts=prompts,
                narrative=narrative,
                existing=list(existing),
                max_tokens=target.params.max_tokens_for(RouteTask.REPAIR),
                steps=steps,
            )
        except asyncio.CancelledError:
            # 超过时限被取消（或者进程正在关闭）
            record("cancelled", None, 0)
            log.warning(
                "options.repair_failed",
                model=target.model,
                error_class="CancelledError",
                duration_ms=int((clock() - repair_started) * 1000),
            )
            raise
        except Exception as exc:
            record("failed", type(exc).__name__, 0)
            log.warning(
                "options.repair_failed",
                model=target.model,
                error_class=type(exc).__name__,
                duration_ms=int((clock() - repair_started) * 1000),
            )
            raise
        record("ok", None, len(options))
        log.info(
            "options.repair",
            model=target.model,
            existing=len(list(existing)),
            produced=len(options),
            duration_ms=int((clock() - repair_started) * 1000),
        )
        return options

    return repair


async def finalize_turn(
    header: TurnHeader,
    generation: Generation,
    state_seq: int,
    *,
    routes: RouteResolver,
    hub: ProviderHub,
    prompts: PromptLibrary,
    clock: Callable[[], float],
    repair_timeout_s: float,
) -> TurnOutcome:
    """普通回合收尾：选项不足时补（修复阶梯，protocol/repair.py），记下导演这次运行。"""
    route = generation.route
    repair_runs: list[AgentRunRecord] = []
    repair = _repairer(
        header, route, routes=routes, hub=hub, prompts=prompts, clock=clock, repair_runs=repair_runs
    )

    try:
        outcome = await finalize_director_output(
            generation.parse,
            repair=repair,
            timeout=repair_timeout_s,
        )
    except NarrativeMissing as exc:
        raise narrative_missing(generation) from exc
    # stage：ok 直接合格；salvaged / repaired 修补后合格；missing 选项没补齐，玩家自己写
    log.info(
        "director.parse",
        stage=outcome.stage.value,
        options=len(outcome.options),
        repairs=list(outcome.repairs),
        notes=list(outcome.notes)[:10],
        rewritten=generation.parse.rewritten,
    )
    run = director_run(
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
        state_seq=state_seq,
        runs=[run, *repair_runs],
        director_notes=outcome.director_notes,
    )


async def finalize_greeting(
    header: TurnHeader,
    narrative: str,
    route: ResolvedRoute,
    state_seq: int,
    *,
    routes: RouteResolver,
    hub: ProviderHub,
    prompts: PromptLibrary,
    clock: Callable[[], float],
    repair_timeout_s: float,
) -> TurnOutcome:
    """用卡片的开场白开场：叙述就是开场白，不调导演，只补两个选项（补不齐时玩家自己写）。"""
    repair_runs: list[AgentRunRecord] = []
    repair = _repairer(
        header, route, routes=routes, hub=hub, prompts=prompts, clock=clock, repair_runs=repair_runs
    )
    parse = DirectorParse(
        narrative=narrative, options=(), stage=ParseStage.OK, repairs=(), notes=("greeting",)
    )
    outcome = await finalize_director_output(parse, repair=repair, timeout=repair_timeout_s)
    log.info("director.parse", stage="greeting", options=len(outcome.options))
    return TurnOutcome(
        narrative=outcome.narrative,
        options=make_options(outcome.options),
        options_source=_STAGE_TO_SOURCE[outcome.stage].value,
        usage=None,
        state_seq=state_seq,
        runs=repair_runs,
    )


def finalize_ending(generation: Generation, state_seq: int) -> TurnOutcome:
    """结局：只要叙述，不补选项；模型照习惯写了选项也丢掉。"""
    parse = generation.parse
    if parse.stage is ParseStage.FAILED or not parse.narrative.strip():
        raise narrative_missing(generation)
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
    run = director_run(
        generation,
        status="ok",
        extra={"stage": "ending", "repairs": repairs, "notes": list(parse.notes)[:10]},
    )
    return TurnOutcome(
        narrative=parse.narrative,
        options=[],
        options_source=None,
        usage=generation.usage,
        state_seq=state_seq,
        runs=[run],
        ends_story=True,
        director_notes=parse.director_notes,
    )


def narrative_missing(generation: Generation) -> TurnFailed:
    log.warning("director.parse", stage="narrative_missing")
    run = director_run(generation, status="failed", error_class="narrative_missing")
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


def director_run(
    generation: Generation,
    *,
    status: str,
    error_class: str | None = None,
    extra: dict[str, Any] | None = None,
) -> AgentRunRecord:
    context = generation.context
    result = context_result(generation.route, context)
    result["finish_reason"] = generation.finish_reason
    result["tool_rounds"] = generation.tool_rounds
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
        steps=generation.steps,
    )


def context_result(route: ResolvedRoute, context: AssembledContext) -> dict[str, Any]:
    return {
        "route_id": route.route_id,
        "estimated_tokens": context.estimated_tokens,
        "usage_ratio": round(context.usage_ratio, 4),
        "dropped_turns": context.dropped_turns,
        "recall_before": context.recall_before,
        "prompt_versions": context.prompt_versions,
    }
