"""在 worker 里跑工作台 agent 的一轮（docs/workbench.md 第 4.1 节）。

api 写好用户的消息、把草稿改成 running、放一个 workbench.run 任务；worker 领到以后调 run()：
1. 读出草稿和对话记录，按阶段定这一轮的做法（planning / build / revise）和能用的工具；
2. 跑 card_maker，边做边推事件；
3. 结束：调了问卷、方案、改动 → awaiting_user；说完话 → idle；用户停止、碰到上限、出错 → 写一条
   progress 或 error，回到 idle。记下这一轮结束时卡片的样子（agent_baseline），记一行 agent_runs。

不重试：跑到一半进程挂了，重跑会重复搜索、重复出图。这一轮直接记失败，用户点“接着写完”开下一轮。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx
import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.workbench.digest import is_complete, user_edits
from bettertavern.domain.workbench.stage import RunMode, run_mode, tools_for
from bettertavern.providers import EndpointPolicy, ProviderError, ProviderHub

from .agent import AgentStopped, StepLog
from .agents.card_maker import AGENT, make_card
from .agents.card_maker_tools import CardMakerContext, Limits, registry
from .agents.card_maker_web import SearchMemo, WebTools
from .ports import (
    AgentRunRecord,
    RouteResolver,
    ToolResolver,
    WebStore,
    WorkbenchFinish,
    WorkbenchRun,
    WorkbenchStore,
)
from .prompts import PromptBook
from .turn_stream import failure_from_provider
from .workbench_events import EventBatcher

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class WorkbenchRunnerConfig:
    timeout_s: float = 15 * 60  # 一轮最多多久


@dataclass(frozen=True)
class RunFailure:
    code: str
    message: str
    reason: str | None = None


class WorkbenchRunner:
    def __init__(
        self,
        *,
        store: WorkbenchStore,
        routes: RouteResolver,
        hub: ProviderHub,
        prompts: PromptBook,
        config: WorkbenchRunnerConfig | None = None,
        tools: ToolResolver | None = None,
        web_store: WebStore | None = None,
        http: httpx.AsyncClient | None = None,
        policy: EndpointPolicy | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._routes = routes
        self._hub = hub
        self._prompts = prompts
        self.config = config or WorkbenchRunnerConfig()
        # 联网和出图：外部服务的配置、网页缓存和图片的存取、出站请求用的客户端；没给时不联网
        self._tools = tools
        self._web_store = web_store
        self._http = http
        self._policy = policy or EndpointPolicy()
        self._memo = SearchMemo()
        self._clock = clock

    async def _web(self, run: WorkbenchRun) -> WebTools | None:
        if self._tools is None or self._web_store is None or self._http is None:
            return None
        resolved = await self._tools.resolve_tools(run.user_id)
        return WebTools(
            run=run,
            tools=resolved,
            store=self._web_store,
            client=self._http,
            policy=self._policy,
            memo=self._memo,
        )

    async def run(self, draft_id: str, run_id: str) -> None:
        run = await self._store.load_run(draft_id, run_id)
        if run is None:  # 这一轮已经被接管或草稿删了
            log.info("workbench.run_stale", draft_id=draft_id, run_id=run_id)
            return
        structlog.contextvars.bind_contextvars(draft_id=draft_id, run_id=run_id)
        try:
            await self._run(run)
        finally:
            structlog.contextvars.unbind_contextvars("draft_id", "run_id")

    async def _run(self, run: WorkbenchRun) -> None:
        started = self._clock()
        prompts = self._prompts.get(run.language)
        messages: Mapping[str, str] = prompts.data("card_maker")["errors"]
        events = EventBatcher(self._store, run.draft_id, run.run_id)
        plan = _approved_plan(run)
        mode = run_mode(
            stage=run.stage,
            origin=run.origin,
            plan_approved=plan is not None,
            complete=is_complete(run.card),
            trigger=run.trigger,
        )
        edits = tuple(user_edits(run.card, run.baseline, display_name=run.name))
        web = await self._web(run)
        image_budget = _image_budget(plan, run)
        tools = tools_for(
            mode,
            can_search=web is not None and web.can_search,
            can_fetch=web is not None,
            can_images=web is not None and web.can_images,
            image_budget=image_budget if web is not None and web.can_generate else 0,
        )
        ctx = CardMakerContext(
            run=run,
            store=self._store,
            events=events,
            messages=messages,
            mode=mode,
            card=run.card,
            name=run.name,
            version=run.version,
            user_edits=edits,
            todos=[dict(t) for t in run.todos],
            assets={a.id: a for a in run.assets},
            limits=Limits(image_budget=image_budget),
            web=web,
        )
        await self._store.set_stage(run.draft_id, run.run_id, _stage_at_start(mode, run.stage))
        await events.event("status", {"agent_status": "running", "mode": mode})
        steps = StepLog()
        route = await self._routes.resolve(run.user_id, RouteTask.WORKBENCH)
        failure: RunFailure | None = None
        stopped = False
        stats = None
        if route is None:
            failure = RunFailure("ROUTE_MISSING", "No model is set up for the workbench")
        elif not route.caps.tools:
            failure = RunFailure(
                "TOOLS_UNSUPPORTED",
                "The workbench model can't call tools; choose another model in Settings",
            )
        else:
            try:
                async with asyncio.timeout(self.config.timeout_s):
                    stats = await make_card(
                        self._hub,
                        route,
                        ctx,
                        prompts,
                        registry(web.tool_list() if web is not None else ()),
                        tools=tools,
                        plan=plan,
                        steps=steps,
                    )
            except AgentStopped:
                stopped = True
            except TimeoutError:
                failure = RunFailure("RUN_TIMEOUT", "This round took too long and was stopped")
            except ProviderError as exc:
                turn_failure = failure_from_provider(exc)
                failure = RunFailure(turn_failure.code, turn_failure.message, exc.error_class.value)
        if failure is None and not stopped and ctx.ended is None:
            stopped = await self._store.should_stop(run.draft_id, run.run_id)
        await events.flush()
        await self._finish(run, ctx, mode, route, steps, stats, failure, stopped, started)

    async def _finish(
        self,
        run: WorkbenchRun,
        ctx: CardMakerContext,
        mode: RunMode,
        route: Any,
        steps: StepLog,
        stats: Any,
        failure: RunFailure | None,
        stopped: bool,
        started: float,
    ) -> None:
        web = ctx.web if isinstance(ctx.web, WebTools) else None
        if web is not None and (web.searches or web.pages):
            await self._store.append_message(
                run.draft_id,
                run.run_id,
                kind="research",
                content={
                    "searches": web.searches,
                    "pages": web.pages,
                    "images": sum(1 for a in ctx.assets.values() if a.source == "search"),
                },
            )
        if failure is not None:
            await self._store.append_message(
                run.draft_id,
                run.run_id,
                kind="error",
                content={
                    "code": failure.code,
                    "message": failure.message,
                    "reason": failure.reason,
                },
            )
        elif mode == "build" and ctx.written:
            check = is_complete(ctx.card)
            await self._store.append_message(
                run.draft_id,
                run.run_id,
                kind="progress",
                content={
                    "fields": [w for w in ctx.written if not w.startswith("lore.")],
                    "lore": {"added": ctx.lore_added},
                    "cover": ctx.cover_set,
                    "complete": check,
                    "stopped": stopped,
                },
            )
        if ctx.ended is not None:
            status = "awaiting_user"
            awaiting: Mapping[str, Any] | None = {"kind": ctx.ended, "seq": ctx.awaiting_seq}
        else:
            status, awaiting = "idle", None
        stage = _stage_at_end(mode, ctx, failure is not None or stopped)
        elapsed = int((self._clock() - started) * 1000)
        result = {
            "mode": mode,
            "ended": ctx.ended,
            "stopped": stopped,
            "model_calls": stats.model_calls if stats is not None else 0,
            "tool_calls": ctx.limits.tool_calls,
            "searches": ctx.limits.searches,
            "pages": ctx.limits.pages,
            "images": ctx.limits.images,
            "written": len(ctx.written),
        }
        record = AgentRunRecord(
            agent=AGENT,
            task=RouteTask.WORKBENCH.value,
            status="failed" if failure is not None else ("cancelled" if stopped else "ok"),
            provider=route.provider if route is not None else None,
            model=route.model if route is not None else None,
            usage=steps.total_usage(),
            ttft_ms=stats.ttft_ms if stats is not None else None,
            latency_ms=elapsed,
            error_class=(failure.reason or failure.code.lower()) if failure is not None else None,
            result=result,
            steps=steps.steps,
        )
        await self._store.finish(
            run.draft_id,
            run.run_id,
            WorkbenchFinish(stage=stage, agent_status=status, awaiting=awaiting, run=record),
        )
        log.info(
            "workbench.run_finished",
            mode=mode,
            status=record.status,
            error_code=failure.code if failure is not None else None,
            ended=ctx.ended,
            stopped=stopped,
            duration_ms=elapsed,
            **{k: v for k, v in result.items() if k not in ("mode", "ended", "stopped")},
        )


def _approved_plan(run: WorkbenchRun) -> Mapping[str, Any] | None:
    """用户确认的那份方案（加上确认时选的名字）。"""
    if run.plan_approved_seq is None:
        return None
    plan = next(
        (m for m in run.messages if m.seq == run.plan_approved_seq and m.kind == "plan"), None
    )
    if plan is None:
        return None
    reply = next(
        (
            m
            for m in run.messages
            if m.seq > run.plan_approved_seq
            and m.kind == "plan_reply"
            and m.content.get("approved")
        ),
        None,
    )
    chosen = reply.content.get("name") if reply is not None else None
    return {**plan.content, "chosen_name": chosen or (plan.content.get("names") or [""])[0]}


def _image_budget(plan: Mapping[str, Any] | None, run: WorkbenchRun) -> int:
    """确认的方案里写了生成几张，减去已经生成过的。"""
    if plan is None:
        return 0
    cover = plan.get("cover") or {}
    if cover.get("mode") != "generate":
        return 0
    generated = sum(1 for a in run.assets if a.source == "generated")
    return max(0, int(cover.get("count") or 0) - generated)


def _stage_at_start(mode: RunMode, stage: str) -> str:
    if mode == "build":
        return "build"
    if mode == "revise":
        return "revise"
    return stage if stage in ("research", "questions", "plan") else "start"


def _stage_at_end(mode: RunMode, ctx: CardMakerContext, interrupted: bool) -> str:
    if ctx.ended == "questions":
        return "questions"
    if ctx.ended == "plan":
        return "plan"
    if mode == "build":
        return "done" if is_complete(ctx.card) and not interrupted else "build"
    if mode == "revise":
        return "revise"
    return "start"
