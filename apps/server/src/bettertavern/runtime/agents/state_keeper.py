"""世界状态 agent：每回合在后台读这一回合的叙述，用工具改世界状态，最后用 commit 结束
（docs/agent-runtime.md 第 4 节“世界状态 agent”）。

- 输入由代码拼好：这一回合的玩家行动、叙述和导演的隐藏备注、前几回合的一句话摘要、当前场景、
  相关实体的资料（主角、场景地点、在场人物、主角的随身物品、这一回合文字里提到名字的实体）、
  相关的事实和没解开的线索；
- 修改只作用到这次运行的修改清单（WorldDraft），commit 通过检查后才算完成；写入数据库由调用方做；
- 模型调用不是流式的，每次调用记一步。

工具在同级文件 state_keeper_tools.py。
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.world.draft import DraftResult, WorldDraft
from bettertavern.domain.world.mentions import mentioned
from bettertavern.domain.world.records import EntityRecord
from bettertavern.domain.world.threads import ThreadDraft
from bettertavern.providers import (
    ChatRequest,
    Message,
    ProviderAdapter,
    ProviderError,
    ToolSpec,
)
from bettertavern.runtime.agent import (
    AgentSpec,
    ModelReply,
    OutputKind,
    StepLog,
    clip_text,
    run_agent,
)
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import StateTurn
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.routing import ResolvedRoute

from .state_keeper_tools import (
    FINISH_TOOL,
    REGISTRY,
    TOOL_NAMES,
    StateToolContext,
    describe,
    describe_fact,
    describe_thread,
    ref_labels,
    to_json,
)

AGENT = "state_keeper"
MAX_TOOL_ROUNDS = 20
MAX_RELATED = 24  # 输入里最多列几个相关实体
MAX_FACTS = 24  # 输入里最多列几条相关事实
# 输入里最多列几条没解开的线索：涉及相关实体的在前，其余按记下的回合从早到晚。
# 不少于没解开的线索的上限（threads.py），好让模型看得到每一条，才能解开或合并
MAX_THREADS = 16

SPEC = AgentSpec(
    name=AGENT,
    task=RouteTask.STATE_KEEPER,
    output=OutputKind.FINISH_TOOL,
    tools=TOOL_NAMES,
    max_tool_rounds=MAX_TOOL_ROUNDS,
    finish_tool=FINISH_TOOL,
)


class NoCommit(Exception):
    """模型没有用 commit 结束：轮数用完了，或者 commit 一直没通过检查。"""


@dataclass(frozen=True)
class KeptState:
    result: DraftResult
    rejected: tuple[Mapping[str, str], ...]  # 被拒绝的修改：工具名和原因代码
    model_calls: int


def related_entities(draft: WorldDraft, texts: Sequence[str]) -> list[EntityRecord]:
    """这一回合大概率要改的实体：主角、场景地点、在场人物、主角带着的东西、文字里提到的。"""
    hero = draft.protagonist
    scene = dict(draft.world.data.get("scene") or {})
    picked: dict[str, EntityRecord] = {hero.id: hero}

    def add(entity_id: Any) -> None:
        if entity_id and str(entity_id) not in picked:
            entity = draft.entity(str(entity_id))
            if not entity.retired:
                picked[entity.id] = entity

    add(scene.get("location"))
    place = draft.place_of(hero.id)
    if place is not None:
        add(place[1].id)
    for person in scene.get("present") or ():
        add(person)
    for item in draft.sources(hero.id, "held_by"):
        add(item.id)
    living = [e for e in draft.entities if not e.retired and e.kind != "world"]
    for entity in mentioned(living, texts):
        add(entity.id)
    return list(picked.values())[:MAX_RELATED]


def state_messages(
    turn: StateTurn, draft: WorldDraft, threads: ThreadDraft, prompts: PromptLibrary
) -> list[Message]:
    action = turn.action.text or ""
    related = related_entities(draft, [action, turn.narrative, turn.director_notes])
    ids = {e.id for e in related}
    facts = [f for f in reversed(draft.facts) if ids.intersection(f.entity_ids)][:MAX_FACTS]
    open_threads = threads.open_threads
    shown = sorted(open_threads, key=lambda t: not ids.intersection(t.entity_ids))[:MAX_THREADS]
    scene = dict(draft.world.data.get("scene") or {})
    clock = draft.world.data.get("clock")
    system = prompts.render("state_keeper.system")
    user = prompts.render(
        "state_keeper.turn",
        seq=turn.seq,
        scene_start=turn.scene_start,
        recent=[(seq, sanitize_for_fence(digest)) for seq, digest in turn.recent],
        source=turn.action.source,
        action=sanitize_for_fence(action),
        narrative=sanitize_for_fence(turn.narrative),
        clock=sanitize_for_fence(str(clock)) if clock else "",
        goal=sanitize_for_fence(str(scene.get("goal") or "")),
        entities=[to_json(describe(draft, e, summary_chars=200)) for e in related],
        facts=[to_json(describe_fact(draft, f)) for f in facts],
        threads=[to_json(describe_thread(draft, threads, t)) for t in shown],
        notes=sanitize_for_fence(turn.director_notes),
    )
    return [
        Message(role="system", content=system.text),
        Message(role="user", content=user.text),
    ]


async def keep_state(
    adapter: ProviderAdapter,
    route: ResolvedRoute,
    turn: StateTurn,
    prompts: PromptLibrary,
    *,
    steps: StepLog,
    refs: dict[str, str] | None = None,
    new_id: Callable[[], str] = lambda: str(uuid.uuid4()),
    clock: Callable[[], float] = time.perf_counter,
) -> KeptState:
    """refs 不为空时，结束（包括出错、超时）前填进这次运行用过的编号对应的名字。"""
    draft = WorldDraft(turn.world, seq=turn.seq, turn_id=turn.turn_id, new_id=new_id)
    threads = ThreadDraft(turn.world.threads, seq=turn.seq, turn_id=turn.turn_id, new_id=new_id)
    ctx = StateToolContext(draft=draft, threads=threads, messages=prompts.data("state_keeper"))
    calls = 0

    async def call(
        messages: Sequence[Message], tools: Sequence[ToolSpec] | None
    ) -> ModelReply[None]:
        nonlocal calls
        calls += 1
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
            "round": calls,
            "messages": len(messages),
            "tools": [t.name for t in tools] if tools else None,
        }
        started = clock()
        try:
            result = await adapter.complete(request, route.credential, route.caps)
        except ProviderError as exc:
            steps.model(
                args=args,
                result={"error": exc.error_class.value, "status": exc.status},
                latency_ms=int((clock() - started) * 1000),
            )
            raise
        steps.model(
            args=args,
            result={
                "text": clip_text(result.text),
                "tool_calls": [
                    {"name": c.name, "arguments": clip_text(c.arguments)} for c in result.tool_calls
                ],
                "finish_reason": result.finish_reason,
            },
            latency_ms=int((clock() - started) * 1000),
            usage=result.usage,
        )
        return ModelReply(
            value=None,
            text=result.text,
            tool_calls=result.tool_calls,
            reasoning=result.reasoning if route.caps.echo_reasoning_with_tools else "",
        )

    messages = state_messages(turn, draft, threads, prompts)
    try:
        await run_agent(
            SPEC, messages, call, steps=steps, prompts=prompts, registry=REGISTRY, ctx=ctx
        )
    finally:
        if refs is not None:
            refs.update(ref_labels(draft, steps.steps, threads))
    if draft.result is None:
        raise NoCommit(f"no accepted commit after {calls} model calls")
    return KeptState(result=draft.result, rejected=tuple(ctx.rejected), model_calls=calls)
