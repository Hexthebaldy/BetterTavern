"""章节整理：一章结束时在后台读这一章的原文，写章节摘要、改写玩家画像；还没并进全书梗概的
章节摘要已经有 3 章时，顺带把最早一章并进全书梗概（docs/agent-runtime.md 第 4 节“章节整理”）。

一章在哪里结束由代码按固定规则定（domain/memory/chapters.py），不让模型判断。
输出是规定格式的 JSON，走结构化输出阶梯；写入数据库由调用方（runtime/memory_runner.py）做。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel, Field

from bettertavern.domain.memory.chapters import KEPT_CHAPTERS
from bettertavern.domain.routing import RouteTask
from bettertavern.providers import (
    Message,
    NegativeCapabilityCache,
    ProviderAdapter,
    ToolSpec,
)
from bettertavern.providers.capabilities import StructuredMode
from bettertavern.runtime.agent import AgentSpec, ModelReply, OutputKind, StepLog, run_agent
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.ports import ChapterSummary, MemoryWork
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.structured import (
    StructuredResult,
    run_structured,
    schema_text,
)
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "chapter_writer"

SPEC = AgentSpec(name=AGENT, task=RouteTask.COMPACTOR, output=OutputKind.STRUCTURED)

# 提示词里要求的上限是 500、800、1500 字；超出一点的截掉，不让一份记忆越写越长
CHAPTER_CHARS = 600
PROFILE_CHARS = 900
SYNOPSIS_CHARS = 1800


class ChapterOutput(BaseModel):
    chapter_summary: str = Field(min_length=1)
    player_profile: str = Field(min_length=1)


class ChapterFoldOutput(ChapterOutput):
    synopsis: str = Field(min_length=1)


@dataclass(frozen=True)
class WrittenChapter:
    chapter: str
    profile: str
    synopsis: str | None  # 并进了最早一章时的新梗概
    folded: ChapterSummary | None  # 并进梗概的那一章
    structured: StructuredResult[ChapterOutput]
    prompt_hash: str | None


def _clip(text: str, limit: int) -> str:
    return text.strip()[:limit]


async def write_chapter(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    work: MemoryWork,
    last_seq: int,
    prompts: PromptLibrary,
    *,
    steps: StepLog,
    negative_cache: NegativeCapabilityCache | None = None,
) -> WrittenChapter:
    """这一章是 work.turns 里到 last_seq 为止的回合。"""
    memory = work.memory
    turns = [t for t in work.turns if t.seq <= last_seq]
    fold = memory.chapters[0] if len(memory.chapters) >= KEPT_CHAPTERS else None
    previous: Sequence[ChapterSummary] = memory.chapters[1:] if fold else memory.chapters
    output: type[ChapterOutput] = ChapterFoldOutput if fold else ChapterOutput
    schema_data = prompts.data("schema/chapter")
    notes: dict[str, str] = schema_data["fields"]
    hashes: list[str] = []

    def build_messages(mode: StructuredMode) -> list[Message]:
        prompt = prompts.render(
            "chapter_writer",
            protagonist=sanitize_for_fence(work.protagonist_name),
            first_seq=turns[0].seq,
            last_seq=last_seq,
            synopsis=sanitize_for_fence(memory.synopsis),
            previous=[
                {"first": c.first_seq, "last": c.last_seq, "text": sanitize_for_fence(c.text)}
                for c in previous
            ],
            profile=sanitize_for_fence(memory.profile),
            turns=[
                {
                    "seq": t.seq,
                    "action": ""
                    if t.action.source == "opening"
                    else sanitize_for_fence(t.action.text or ""),
                    "narrative": sanitize_for_fence(t.narrative),
                }
                for t in turns
            ],
            fold={
                "first": fold.first_seq,
                "last": fold.last_seq,
                "text": sanitize_for_fence(fold.text),
            }
            if fold
            else None,
            schema=schema_text(output, notes) if mode in ("json_object", "prompt_json") else "",
        )
        hashes.append(prompt.hash)
        return [Message(role="user", content=prompt.text)]

    async def call(
        _messages: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[StructuredResult[ChapterOutput]]:
        value = await run_structured(
            adapter,
            route.credential,
            route.caps,
            model=route.model,
            output=output,
            name="chapter",
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
    synopsis = value.synopsis if isinstance(value, ChapterFoldOutput) else None
    return WrittenChapter(
        chapter=_clip(value.chapter_summary, CHAPTER_CHARS),
        profile=_clip(value.player_profile, PROFILE_CHARS),
        synopsis=_clip(synopsis, SYNOPSIS_CHARS) if synopsis is not None else None,
        folded=fold,
        structured=result,
        prompt_hash=hashes[-1] if hashes else None,
    )
