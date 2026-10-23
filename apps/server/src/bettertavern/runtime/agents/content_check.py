"""内容检查：官方服务（CONTENT_POLICY=sfw）上保存角色卡之前，让模型判断卡里有没有色情内容。

只问两件事（ContentVerdict）：有没有露骨的性描写或以性为主题；有没有涉及未成年人的性内容。
任一为真就不让存进仓库。卡太长时只看前面一段（CARD_CHARS），控制花费。
卡里的文字一律先过 sanitize_for_fence，放进 <card> 围栏当资料。
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, Field

from bettertavern.domain.scenario.card import CharacterCard
from bettertavern.providers import Message, ProviderAdapter
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.structured import StructuredMode, run_structured, schema_text
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "content_check"
# 送去检查的卡片文字最多这么多字（约 1 万 token）
CARD_CHARS = 20_000


class ContentVerdict(BaseModel):
    sexual: bool = Field(description="Explicit sexual content, or sex as the theme")
    minors: bool = Field(description="Sexual content involving minors")
    reason: str = Field(default="", max_length=200)


@dataclass(frozen=True, slots=True)
class CheckResult:
    allowed: bool
    verdict: ContentVerdict


def card_text(card: CharacterCard, display_name: str = "") -> str:
    """卡里会进上下文的文字，按字段排好；超长时截断。"""
    parts: list[tuple[str, str]] = [
        ("name", display_name or card.name),
        ("tags", ", ".join(card.tags)),
        ("description", card.description),
        ("personality", card.personality),
        ("scenario", card.scenario),
        ("first_mes", card.first_mes),
        *[(f"alternate_greeting_{i + 1}", g) for i, g in enumerate(card.alternate_greetings)],
        ("mes_example", card.mes_example),
        ("system_prompt", card.system_prompt),
        ("post_history_instructions", card.post_history_instructions),
        ("creator_notes", card.creator_notes),
        *[(f"lore_{i + 1}", f"{e.name}: {e.content}") for i, e in enumerate(card.book)],
    ]
    text = "\n\n".join(f"[{label}]\n{value.strip()}" for label, value in parts if value.strip())
    return text[:CARD_CHARS]


async def check_card(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    card: CharacterCard,
    prompts: PromptLibrary,
    *,
    display_name: str = "",
) -> CheckResult:
    schema_data = prompts.data("schema/content_check")
    notes: dict[str, str] = schema_data["fields"]
    text = sanitize_for_fence(card_text(card, display_name))

    def build_messages(mode: StructuredMode) -> list[Message]:
        prompt = prompts.render(
            "content_check",
            card=text,
            schema=schema_text(ContentVerdict, notes)
            if mode in ("json_object", "prompt_json")
            else "",
        )
        return [Message(role="user", content=prompt.text)]

    result = await run_structured(
        adapter,
        route.credential,
        route.caps,
        model=route.model,
        output=ContentVerdict,
        name="verdict",
        description=schema_data["description"],
        build_messages=build_messages,
        prompts=prompts,
        schema_notes=notes,
        max_tokens=route.max_tokens,
        temperature=0.0,
        reasoning=route.reasoning(),
    )
    verdict = result.value
    return CheckResult(allowed=not (verdict.sexual or verdict.minors), verdict=verdict)
