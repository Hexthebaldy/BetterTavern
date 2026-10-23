"""工作台 agent（card_maker）：和用户对话，问清楚、出方案，确认后写角色卡；
写好以后接着改时给出改动对比
（docs/workbench.md 第 4 节）。

- 输出方式是 chat：说的话一边生成一边推（delta），写字段的工具参数也边收边推（field_delta）；
- 上下文按变化快慢排：规则（系统提示词）→ 对话记录 → 资料笔记、草稿概况、用户手动改过的地方、
  进度清单和这一轮要做什么（最后一条消息）。以前几轮调工具的原始结果不放回来；
- 这一轮能用哪些工具由代码按阶段决定（domain/workbench/stage.py），调 ask_user、propose_plan、
  propose_changes 就结束这一轮；每次调模型之前看一眼用户有没有点停止。

工具在 card_maker_tools.py（读写草稿、沟通）和 card_maker_web.py（联网、出图）。
"""

from __future__ import annotations

import contextlib
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import structlog

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.workbench.digest import draft_digest
from bettertavern.domain.workbench.stage import END_TOOLS, RunMode
from bettertavern.providers import (
    ChatRequest,
    Done,
    Message,
    ProviderError,
    ProviderHub,
    ReasoningDelta,
    TextDelta,
    ToolCall,
    ToolCallDelta,
    ToolSpec,
    Usage,
    UsageEvent,
)
from bettertavern.providers.errors import ErrorClass
from bettertavern.providers.limiter import LimiterTimeout
from bettertavern.runtime.agent import (
    AgentSpec,
    ModelReply,
    OutputKind,
    StepLog,
    clip_text,
    run_agent,
)
from bettertavern.runtime.agent.partial_json import PartialStringField
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import WorkbenchMessage, WorkbenchRun
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.routing import ResolvedRoute

from .card_maker_tools import STREAMED_ARGS, CardMakerContext, ToolRegistry, to_json

log = structlog.get_logger(__name__)

AGENT = "card_maker"
MAX_TOOL_ROUNDS = 60
MAX_TRANSCRIPT_MESSAGES = 60  # 对话很长时只带最近这么多条，更早的压成一行说明
SLOT_TIMEOUT_S = 60.0

ALL_TOOLS = (
    "update_todos",
    "read_draft",
    "read_field",
    "check_draft",
    "show_images",
    "web_search",
    "image_search",
    "web_fetch",
    "read_page",
    "save_note",
    "save_image",
    "ask_user",
    "propose_plan",
    "write_field",
    "lore_upsert",
    "lore_delete",
    "set_greetings",
    "set_cover",
    "generate_image",
    "propose_changes",
)

SPEC = AgentSpec(
    name=AGENT,
    task=RouteTask.WORKBENCH,
    output=OutputKind.CHAT,
    tools=ALL_TOOLS,
    max_tool_rounds=MAX_TOOL_ROUNDS,
    end_tools=END_TOOLS,
)


@dataclass(frozen=True)
class ChatTurnStats:
    model_calls: int
    usage: Usage | None
    ttft_ms: int | None


# ---- 上下文 -------------------------------------------------------------------------------


def _render_message(message: WorkbenchMessage, labels: Mapping[str, str]) -> str:
    """一条对话记录 → 给模型看的文字。用户写的文字一律过 sanitize_for_fence。"""
    content = message.content
    kind = message.kind
    if kind == "text":
        return sanitize_for_fence(str(content.get("text") or ""))
    if kind == "answers":
        if content.get("delegated"):
            return labels["delegated"]
        answers = content.get("answers") or {}
        return labels["answers"] + "\n" + sanitize_for_fence(to_json(answers))
    if kind == "plan_reply":
        if content.get("approved"):
            return labels["plan_approved"].format(
                name=sanitize_for_fence(str(content.get("name") or ""))
            )
        return labels["plan_rejected"] + "\n" + sanitize_for_fence(str(content.get("text") or ""))
    if kind == "questions":
        return labels["questions"] + "\n" + to_json(content.get("questions") or [])
    if kind == "plan":
        return labels["plan"] + "\n" + to_json(dict(content))
    if kind == "changes":
        hunks = [
            {
                "id": h.get("id"),
                "target": h.get("target"),
                "summary": h.get("summary"),
                "state": h.get("state"),
            }
            for h in content.get("hunks") or []
        ]
        return labels["changes"] + "\n" + to_json(hunks)
    if kind == "progress":
        return labels["progress"] + "\n" + to_json(dict(content))
    if kind == "images":
        return labels["images"].format(ids=", ".join(content.get("asset_ids") or []))
    if kind == "research":
        return labels["research"] + "\n" + sanitize_for_fence(str(content.get("finding") or ""))
    if kind == "error":
        return labels["error"].format(code=content.get("code") or "")
    return ""


def transcript(run: WorkbenchRun, labels: Mapping[str, str]) -> list[Message]:
    """对话记录 → 交替的 user / assistant 消息；同一方连着的几条合成一条。"""
    items = list(run.messages)
    dropped = max(0, len(items) - MAX_TRANSCRIPT_MESSAGES)
    items = items[dropped:]
    merged: list[tuple[str, list[str]]] = []
    if dropped:
        merged.append(("user", [labels["earlier"].format(n=dropped)]))
    for message in items:
        text = _render_message(message, labels)
        if not text:
            continue
        role = "user" if message.role == "user" else "assistant"
        if merged and merged[-1][0] == role:
            merged[-1][1].append(text)
        else:
            merged.append((role, [text]))
    return [Message(role=role, content="\n\n".join(parts)) for role, parts in merged]  # type: ignore[arg-type]


def card_maker_messages(
    run: WorkbenchRun,
    prompts: PromptLibrary,
    *,
    mode: RunMode,
    tools: Sequence[str],
    user_edits: Sequence[str],
    plan: Mapping[str, Any] | None,
    image_budget: int,
    can_generate: bool = False,
    search_scope: str = "",
) -> list[Message]:
    """search_scope：搜索用的是谁（own 自己配的、platform 官方、wiki 只有维基百科），
    提示词按它说明能查到什么。"""
    labels: Mapping[str, str] = prompts.data("card_maker")["labels"]
    system = prompts.render(
        "card_maker.system",
        mode=mode,
        can_search="web_search" in tools,
        can_fetch="web_fetch" in tools,
        can_generate=can_generate,
        image_budget=image_budget,
        search_scope=search_scope,
    )
    digest = draft_digest(run.card, display_name=run.name, has_cover=run.cover_asset_id is not None)
    state = prompts.render(
        "card_maker.state",
        mode=mode,
        trigger=run.trigger,
        origin=run.origin,
        digest=sanitize_for_fence(to_json(digest)),
        user_edits=list(user_edits),
        todos=[sanitize_for_fence(to_json(dict(t))) for t in run.todos],
        plan=sanitize_for_fence(to_json(dict(plan))) if plan else "",
        notes=[
            {
                "id": n.id,
                "text": sanitize_for_fence(n.text),
                "url": sanitize_for_fence(str(n.source.get("url") or "")),
                "used_in": list(n.used_in),
            }
            for n in run.notes
        ],
        assets=[
            {"id": a.id, "source": a.source, "license": a.license, "size": f"{a.width}x{a.height}"}
            for a in run.assets
        ],
    )
    history = transcript(run, labels)
    if history and history[-1].role == "user":
        last = history.pop()
        history.append(Message(role="user", content=f"{last.content}\n\n{state.text}"))
    else:
        history.append(Message(role="user", content=state.text))
    return [Message(role="system", content=system.text), *history]


# ---- 调模型（流式） ------------------------------------------------------------------------


class _ToolStream:
    """一个工具调用的参数片段：拼起来，同时把要边收边推的正文解出来。"""

    def __init__(self) -> None:
        self.id: str | None = None
        self.name: str | None = None
        self.parts: list[str] = []
        self.body: PartialStringField | None = None
        self.where: PartialStringField | None = None
        self.target: str = ""
        self.held: list[str] = []  # 还不知道写哪里时先攒着


def chat_call(
    hub: ProviderHub,
    route: ResolvedRoute,
    ctx: CardMakerContext,
    steps: StepLog,
    stats: dict[str, Any],
    *,
    clock: Callable[[], float] = time.perf_counter,
) -> Callable[[Sequence[Message], Sequence[ToolSpec] | None], Any]:
    adapter = hub.adapter(route.provider)

    async def call(
        messages: Sequence[Message], tools: Sequence[ToolSpec] | None
    ) -> ModelReply[None]:
        stats["model_calls"] = stats.get("model_calls", 0) + 1
        request = ChatRequest(
            messages=list(messages),
            model=route.model,
            max_tokens=route.max_tokens,
            temperature=route.temperature,
            reasoning=route.reasoning(),
            tools=list(tools) if tools else None,
        )
        args = {
            "provider": route.provider,
            "model": route.model,
            "round": stats["model_calls"],
            "messages": len(messages),
            "tools": [t.name for t in tools] if tools else None,
        }
        text: list[str] = []
        thinking: list[str] = []
        calls: dict[int, _ToolStream] = {}
        usage: Usage | None = None
        finish: str | None = None
        started = clock()
        try:
            async with (
                hub.limiter.slot(
                    route.credential.credential_id, interactive=False, timeout=SLOT_TIMEOUT_S
                ),
                contextlib.aclosing(
                    adapter.stream(request, route.credential, route.caps)
                ) as events,
            ):
                async for event in events:
                    if isinstance(event, TextDelta):
                        if stats.get("ttft_ms") is None:
                            stats["ttft_ms"] = int((clock() - started) * 1000)
                        text.append(event.text)
                        await ctx.events.delta(event.text)
                    elif isinstance(event, ToolCallDelta):
                        await _tool_delta(calls, event, ctx)
                    elif isinstance(event, ReasoningDelta):
                        thinking.append(event.text)
                    elif isinstance(event, UsageEvent):
                        usage = event.usage
                    elif isinstance(event, Done):
                        finish = event.finish_reason
        except LimiterTimeout as exc:
            steps.model(args=args, result={"error": "slot_timeout"})
            raise ProviderError(
                ErrorClass.RATE_LIMIT, "Timed out waiting for a model concurrency slot"
            ) from exc
        except ProviderError as exc:
            steps.model(
                args=args,
                result={
                    "error": exc.error_class.value,
                    "status": exc.status,
                    "text": clip_text("".join(text)),
                },
                latency_ms=int((clock() - started) * 1000),
            )
            raise
        tool_calls = tuple(
            ToolCall(id=part.id or f"call_{index}", name=part.name, arguments="".join(part.parts))
            for index, part in sorted(calls.items())
            if part.name
        )
        result: dict[str, Any] = {"text": clip_text("".join(text)), "finish_reason": finish}
        if tool_calls:
            result["tool_calls"] = [
                {"name": c.name, "arguments": clip_text(c.arguments)} for c in tool_calls
            ]
        steps.model(
            args=args, result=result, latency_ms=int((clock() - started) * 1000), usage=usage
        )
        log.info(
            "workbench.model_call",
            round=stats["model_calls"],
            tools=[c.name for c in tool_calls],
            finish_reason=finish,
            prompt_tokens=usage.prompt if usage else None,
            completion_tokens=usage.completion if usage else None,
            duration_ms=int((clock() - started) * 1000),
        )
        said = "".join(text).strip()
        await ctx.events.flush()
        if said:
            await ctx.store.append_message(
                ctx.run.draft_id, ctx.run.run_id, kind="text", content={"text": said}
            )
        return ModelReply(
            value=None,
            text="".join(text),
            tool_calls=tool_calls,
            reasoning="".join(thinking) if route.caps.echo_reasoning_with_tools else "",
        )

    return call


async def _tool_delta(
    calls: dict[int, _ToolStream], event: ToolCallDelta, ctx: CardMakerContext
) -> None:
    part = calls.setdefault(event.index, _ToolStream())
    part.id = part.id or event.id
    if part.name is None and event.name:
        part.name = event.name
        streamed = STREAMED_ARGS.get(event.name)
        if streamed is not None:
            part.body = PartialStringField(streamed[0])
            part.where = PartialStringField(streamed[1]) if streamed[1] else None
            await ctx.events.event("tool", {"name": event.name, "state": "start"})
    part.parts.append(event.arguments)
    if part.body is None:
        return
    if part.where is not None and not part.where.done:
        part.target += part.where.feed(event.arguments)
    piece = part.body.feed(event.arguments)
    if not piece:
        return
    if part.where is not None and not part.where.done:
        part.held.append(piece)  # 正文先到、还不知道写哪里：等名字齐了再推
        return
    if part.held:
        piece = "".join(part.held) + piece
        part.held.clear()
    target = {"field": part.target} if part.name == "write_field" else {"lore": part.target}
    await ctx.events.field_delta(target, piece)


async def make_card(
    hub: ProviderHub,
    route: ResolvedRoute,
    ctx: CardMakerContext,
    prompts: PromptLibrary,
    registry: ToolRegistry,
    *,
    tools: Sequence[str],
    plan: Mapping[str, Any] | None,
    steps: StepLog,
) -> ChatTurnStats:
    """跑一轮；出错（ProviderError、超时）由调用方处理。"""
    stats: dict[str, Any] = {}
    messages = card_maker_messages(
        ctx.run,
        prompts,
        mode=ctx.mode,
        tools=tools,
        user_edits=ctx.user_edits,
        plan=plan,
        image_budget=ctx.limits.image_budget if "generate_image" in tools else 0,
        can_generate=ctx.web is not None and ctx.web.can_generate,
        search_scope=ctx.web.search_scope if ctx.web is not None else "",
    )

    async def should_stop() -> bool:
        await ctx.events.flush()
        if ctx.ended is not None:
            return True
        return await ctx.store.should_stop(ctx.run.draft_id, ctx.run.run_id)

    await run_agent(
        SPEC,
        messages,
        chat_call(hub, route, ctx, steps, stats),
        steps=steps,
        prompts=prompts,
        registry=registry,
        ctx=ctx,
        available=tools,
        should_stop=should_stop,
    )
    await ctx.events.flush()
    return ChatTurnStats(
        model_calls=int(stats.get("model_calls", 0)),
        usage=steps.total_usage(),
        ttft_ms=stats.get("ttft_ms"),
    )
