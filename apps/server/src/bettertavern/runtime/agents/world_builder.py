"""开局构建（WorldBuilder）：把角色卡变成第一人称故事的起点 Seed。一次结构化调用，限时由调用方控制。

角色卡文字按“数据”放进 <character-card> 围栏，不当指令；{{user}} 换成主角名，{{char}} 换成角色名。
角色卡内嵌的 character_book 只做一次性提炼：最多 40 条，常驻条目优先。
群像剧本有几张卡：第一张是主角色卡，其余的作为“另一位关键人物”一起交给模型（每张的字数按张数分摊）；
几张卡的世界书合在一起，名字重复的条目按卡的顺序取第一张的。剧本设置里选了开场白时，
把它当作故事的开头交给模型，开场设定要和它衔接。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.scenario.card import CharacterCard, LoreEntry, apply_macros
from bettertavern.domain.world.names import normalize_name
from bettertavern.domain.world.seed import Seed, normalize_seed
from bettertavern.providers import (
    CancelToken,
    Message,
    NegativeCapabilityCache,
    ProviderAdapter,
    ToolSpec,
)
from bettertavern.providers.capabilities import StructuredMode
from bettertavern.runtime.agent import AgentSpec, ModelReply, OutputKind, StepLog, run_agent
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import AgentRunRecord, WorldBuildInput
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.structured import (
    StructuredResult,
    run_structured,
    schema_text,
)
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "world_builder"

SPEC = AgentSpec(name=AGENT, task=RouteTask.WORLD_BUILDER, output=OutputKind.STRUCTURED)
BOOK_ENTRIES = 40
BOOK_ENTRY_CHARS = 800
BOOK_TOTAL_CHARS = 12_000
FIELD_LIMITS = {
    "description": 6000,
    "personality": 2000,
    "scenario": 3000,
    "first_mes": 3000,
    "mes_example": 3000,
}


@dataclass(frozen=True)
class WorldBuildResult:
    seed: Seed
    run: AgentRunRecord


def select_book(entries: tuple[LoreEntry, ...]) -> list[LoreEntry]:
    """常驻条目优先，其次按插入顺序；总字数有上限。"""
    enabled = [e for e in entries if e.enabled and e.content.strip()]
    enabled.sort(key=lambda e: (not e.constant, e.order))
    picked: list[LoreEntry] = []
    total = 0
    for entry in enabled:
        if len(picked) >= BOOK_ENTRIES:
            break
        content = entry.content.strip()[:BOOK_ENTRY_CHARS]
        if total + len(content) > BOOK_TOTAL_CHARS:
            break
        total += len(content)
        picked.append(entry.model_copy(update={"content": content}))
    return picked


def merged_book(cards: Sequence[CharacterCard]) -> list[tuple[LoreEntry, str]]:
    """几张卡的世界书合在一起：名字重复的条目按卡的顺序取第一张的。返回（条目，它属于的角色名）。"""
    seen: set[str] = set()
    merged: list[tuple[LoreEntry, str]] = []
    for index, card in enumerate(cards):
        for entry in card.book:
            key = normalize_name(entry.name) if entry.name.strip() else ""
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            # 先按卡的顺序、再按卡里的顺序排：order 加上卡的序号作为高位
            merged.append(
                (entry.model_copy(update={"order": index * 100_000 + entry.order}), card.name)
            )
    return merged


def render_prompt_context(card: CharacterCard, inp: WorldBuildInput) -> dict[str, object]:
    user = inp.protagonist_name
    cards = list(inp.cards) or [card]
    share = max(len(cards), 1)

    def field(c: CharacterCard, name: str) -> str:
        limit = max(FIELD_LIMITS[name] // share, FIELD_LIMITS[name] // 4)
        text = apply_macros(getattr(c, name), user=user, char=c.name)[:limit]
        return sanitize_for_fence(text.strip())

    owners: dict[int, str] = {}
    book_entries: list[LoreEntry] = []
    for entry, owner in merged_book(cards):
        owners[entry.order] = owner
        book_entries.append(entry)
    opening_chosen = bool(inp.opening.strip())
    opening = (
        apply_macros(inp.opening, user=user, char=inp.opening_char or card.name)[
            : FIELD_LIMITS["first_mes"]
        ]
        if opening_chosen
        else apply_macros(card.first_mes, user=user, char=card.name)[: FIELD_LIMITS["first_mes"]]
    )
    return {
        "card_name": sanitize_for_fence(card.name),
        "protagonist_name": sanitize_for_fence(user),
        "protagonist_summary": sanitize_for_fence(inp.protagonist_summary),
        "description": field(card, "description"),
        "personality": field(card, "personality"),
        "scenario": field(card, "scenario"),
        "first_mes": sanitize_for_fence(opening.strip()),
        "opening_chosen": opening_chosen,
        "mes_example": field(card, "mes_example"),
        "others": [
            {
                "name": sanitize_for_fence(other.name),
                "description": field(other, "description"),
                "personality": field(other, "personality"),
                "scenario": field(other, "scenario"),
                "mes_example": field(other, "mes_example"),
            }
            for other in cards[1:]
        ],
        "book": [
            {
                "name": sanitize_for_fence(
                    apply_macros(e.name, user=user, char=owners.get(e.order, card.name))
                ),
                "content": sanitize_for_fence(
                    apply_macros(e.content, user=user, char=owners.get(e.order, card.name))
                ),
            }
            for e in select_book(tuple(book_entries))
        ],
        "style": sanitize_for_fence(inp.preferences.style),
        "boundaries": sanitize_for_fence(inp.preferences.boundaries),
    }


async def build_seed(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    card: CharacterCard,
    inp: WorldBuildInput,
    *,
    prompts: PromptLibrary,
    negative_cache: NegativeCapabilityCache | None = None,
    cancel: CancelToken | None = None,
    steps: StepLog | None = None,
) -> WorldBuildResult:
    """steps 由调用方给，失败时调用方也能拿到已经发生的步骤。"""
    steps = steps if steps is not None else StepLog()
    context = render_prompt_context(card, inp)
    # 字段说明和工具说明随这一局的语言（runtime/prompts/<lang>/schema/seed.json）
    schema_data = prompts.data("schema/seed")
    notes: dict[str, str] = schema_data["fields"]
    rendered_hash: list[str] = []

    def build_messages(mode: StructuredMode) -> list[Message]:
        show_schema = mode in ("json_object", "prompt_json")
        prompt = prompts.render(
            "world_builder", schema=schema_text(Seed, notes) if show_schema else "", **context
        )
        rendered_hash.append(prompt.hash)
        return [Message(role="user", content=prompt.text)]

    async def call(
        _messages: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[StructuredResult[Seed]]:
        # 消息按结构化输出的方式现拼（build_messages），所以不用循环传进来的消息
        value = await run_structured(
            adapter,
            route.credential,
            route.caps,
            model=route.model,
            output=Seed,
            name="seed",
            description=schema_data["description"],
            build_messages=build_messages,
            prompts=prompts,
            schema_notes=notes,
            max_tokens=route.max_tokens,
            temperature=route.temperature,
            reasoning=route.reasoning(),
            negative_cache=negative_cache,
            cancel=cancel,
            steps=steps,
        )
        return ModelReply(value=value)

    result = await run_agent(SPEC, [], call, steps=steps, prompts=prompts)
    seed = normalize_seed(
        result.value,
        protagonist_name=inp.protagonist_name,
        card_name=card.name,
        other_names=[c.name for c in inp.cards[1:]],
    )
    run = AgentRunRecord(
        agent=AGENT,
        task=route.task.value,
        status="ok",
        provider=route.provider,
        model=route.model,
        prompt_hash=rendered_hash[-1] if rendered_hash else None,
        usage=result.usage,
        latency_ms=result.latency_ms,
        result={
            "mode": result.mode,
            "attempts": result.attempts,
            "characters": len(seed.characters),
            "locations": len(seed.locations),
            "facts": len(seed.facts),
        },
        steps=steps.steps,
    )
    return WorldBuildResult(seed=seed, run=run)


def failure_run(
    route: ResolvedRoute | None,
    error_class: str,
    detail: str,
    latency_ms: int,
    steps: StepLog | None = None,
) -> AgentRunRecord:
    return AgentRunRecord(
        agent=AGENT,
        task="world_builder",
        status="failed",
        provider=route.provider if route else None,
        model=route.model if route else None,
        latency_ms=latency_ms,
        error_class=error_class,
        result={"detail": detail[:300]},
        steps=steps.steps if steps is not None else (),
    )
