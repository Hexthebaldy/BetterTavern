"""大纲修订：在后台写第一版大纲，之后按世界状态 agent 留下的“大纲要改”的原因决定改不改
（docs/agent-runtime.md 第 4 节“大纲修订”）。

还没有大纲时直接写一版；有大纲时先回答改不改，改就写完整的新一版。模型写出的大纲由调用方
（runtime/outline_runner.py）过 settle() 修正后再写入数据库，规则不交回模型。
输出是规定格式的 JSON，走结构化输出阶梯。
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Self

from pydantic import BaseModel, model_validator

from bettertavern.domain.memory.outline import Outline
from bettertavern.domain.routing import RouteTask
from bettertavern.domain.world.seed import Seed
from bettertavern.providers import (
    Message,
    NegativeCapabilityCache,
    ProviderAdapter,
    ToolSpec,
)
from bettertavern.providers.capabilities import StructuredMode
from bettertavern.runtime.agent import AgentSpec, ModelReply, OutputKind, StepLog, run_agent
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import OutlineWork
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.structured import (
    StructuredResult,
    run_structured,
    schema_text,
)
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "outline_writer"

SPEC = AgentSpec(name=AGENT, task=RouteTask.OUTLINE, output=OutputKind.STRUCTURED)

# 开局设定里每个人物只给前几个、每段文字截短：写大纲要的是方向，不是全部细节
SEED_CHARACTERS = 8
SEED_CHARS = 400
REASON_CHARS = 200


class OutlineDecision(BaseModel):
    change: bool
    reason: str = ""
    outline: Outline | None = None

    @model_validator(mode="after")
    def _outline_when_changed(self) -> Self:
        if self.change and self.outline is None:
            raise ValueError("outline is required when change is true")
        return self


@dataclass(frozen=True)
class WrittenOutline:
    outline: Outline | None  # 不改时为空；还没过 settle()
    reason: str
    structured: StructuredResult[Any]
    prompt_hash: str | None


def _short(text: str) -> str:
    return sanitize_for_fence(" ".join(text.split())[:SEED_CHARS])


def seed_view(seed: Seed | None) -> dict[str, Any] | None:
    if seed is None:
        return None
    return {
        "title": _short(seed.world.title),
        "setting": _short(seed.world.setting),
        "tone": _short(seed.world.tone),
        "protagonist": _short(seed.protagonist.summary),
        "goal": _short(seed.protagonist.goal),
        "characters": [
            {"name": _short(c.name), "summary": _short(c.summary), "goal": _short(c.goal)}
            for c in seed.characters[:SEED_CHARACTERS]
        ],
        "situation": _short(seed.opening.situation),
        "hook": _short(seed.opening.hook),
    }


async def write_outline(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    work: OutlineWork,
    prompts: PromptLibrary,
    *,
    steps: StepLog,
    negative_cache: NegativeCapabilityCache | None = None,
) -> WrittenOutline:
    first = work.outline is None
    output: type[BaseModel] = Outline if first else OutlineDecision
    memory = work.memory
    schema_data = prompts.data("schema/outline")
    notes: dict[str, str] = schema_data["fields"]
    hashes: list[str] = []

    def build_messages(mode: StructuredMode) -> list[Message]:
        prompt = prompts.render(
            "outline_writer",
            first=first,
            protagonist=sanitize_for_fence(work.protagonist_name),
            seed=seed_view(work.seed),
            synopsis=sanitize_for_fence(memory.synopsis),
            chapters=[
                {"first": c.first_seq, "last": c.last_seq, "text": sanitize_for_fence(c.text)}
                for c in memory.chapters
            ],
            profile=sanitize_for_fence(memory.profile),
            based_on_seq=work.based_on_seq,
            digests=[{"seq": s, "text": sanitize_for_fence(t)} for s, t in work.digests],
            threads=[
                {"text": sanitize_for_fence(t.text), "answer": sanitize_for_fence(t.answer)}
                for t in work.threads
            ],
            outline=sanitize_for_fence(
                json.dumps(work.outline.model_dump(mode="json"), ensure_ascii=False, indent=1)
            )
            if work.outline is not None
            else "",
            reasons=[
                {"seq": s, "text": sanitize_for_fence(t[:REASON_CHARS])} for s, t in work.reasons
            ],
            schema=schema_text(output, notes) if mode in ("json_object", "prompt_json") else "",
        )
        hashes.append(prompt.hash)
        return [Message(role="user", content=prompt.text)]

    async def call(
        _messages: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[StructuredResult[Any]]:
        value = await run_structured(
            adapter,
            route.credential,
            route.caps,
            model=route.model,
            output=output,
            name="outline",
            description=schema_data["description"],
            build_messages=build_messages,
            prompts=prompts,
            schema_notes=notes,
            max_tokens=route.max_tokens,
            temperature=route.temperature,
            reasoning=route.reasoning(),
            negative_cache=negative_cache,
            steps=steps,
        )
        return ModelReply(value=value)

    result = await run_agent(SPEC, [], call, steps=steps, prompts=prompts)
    value = result.value
    if isinstance(value, OutlineDecision):
        outline = value.outline if value.change else None
        reason = value.reason
    else:
        assert isinstance(value, Outline)
        outline, reason = value, ""
    return WrittenOutline(
        outline=outline,
        reason=" ".join(reason.split())[:REASON_CHARS],
        structured=result,
        prompt_hash=hashes[-1] if hashes else None,
    )
