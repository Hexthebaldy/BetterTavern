"""Illustrator：把一回合写成给出图服务的英文画面描述（docs/illustrations.md 第 2 节）。

非流式调一次模型，要它回一个 JSON：{"prompt": 英文画面描述, "people": [画里有谁]}。
people 里的名字按给它的名单原样写，用来挑参考图（卡的封面、人设的头像）。
回的不是 JSON 但有文字时，整段当画面描述用（不带参考图）；什么都没有算失败。
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass

from bettertavern.domain.routing import RouteTask
from bettertavern.providers import (
    ChatRequest,
    ChatResult,
    Message,
    ProviderAdapter,
    ProviderError,
    ResponseFormat,
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
from bettertavern.runtime.ports import IllustrationWork
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.json_extract import extract_json_object
from bettertavern.runtime.routing import ResolvedRoute

AGENT = "illustrator"

SPEC = AgentSpec(name=AGENT, task=RouteTask.ILLUSTRATOR, output=OutputKind.STRUCTURED)

MAX_PROMPT_CHARS = 1500  # 画面描述最多这么长（出图服务大多限制在一两千字符以内）
NARRATIVE_CHARS = 6000  # 正文太长时只留开头和结尾
PREVIOUS_CHARS = 600
DESCRIPTION_CHARS = 800  # 每个人的描述


class NoScene(Exception):
    """模型什么都没写出来。"""


@dataclass(frozen=True)
class Scene:
    prompt: str
    people: tuple[str, ...]
    prompt_hash: str


def _clip_middle(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    half = limit // 2
    return f"{text[:half]}\n…\n{text[-half:]}"


async def write_scene(
    route: ResolvedRoute,
    adapter: ProviderAdapter,
    work: IllustrationWork,
    prompts: PromptLibrary,
    *,
    steps: StepLog,
) -> Scene:
    figures = [
        {
            "name": sanitize_for_fence(f.name),
            "description": sanitize_for_fence(f.description[:DESCRIPTION_CHARS]),
            "protagonist": f.protagonist,
        }
        for f in work.figures
    ]
    rendered = prompts.render(
        "illustrator",
        world=sanitize_for_fence(work.world),
        location=sanitize_for_fence(work.location),
        figures=figures,
        previous=sanitize_for_fence(work.previous[-PREVIOUS_CHARS:]),
        action=sanitize_for_fence(work.action),
        narrative=sanitize_for_fence(_clip_middle(work.narrative, NARRATIVE_CHARS)),
        request=sanitize_for_fence(work.request),
    )
    caps = route.caps
    use_json_object = "json_object" in caps.structured

    async def call(
        messages: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[ChatResult]:
        request = ChatRequest(
            messages=list(messages),
            model=route.model,
            max_tokens=route.max_tokens,
            temperature=route.temperature,
            reasoning=route.reasoning(),
            response_format=ResponseFormat(type="json_object") if use_json_object else None,
        )
        args = {"model": route.model, "json_object": use_json_object}
        started = time.perf_counter()
        try:
            result = await adapter.complete(request, route.credential, caps)
        except ProviderError as exc:
            steps.model(
                args=args,
                result={"error": exc.error_class.value, "status": exc.status},
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            raise
        steps.model(
            args=args,
            result={"text": clip_text(result.text), "finish_reason": result.finish_reason},
            latency_ms=int((time.perf_counter() - started) * 1000),
            usage=result.usage,
        )
        return ModelReply(value=result, text=result.text)

    result = await run_agent(
        SPEC, [Message(role="user", content=rendered.text)], call, steps=steps, prompts=prompts
    )
    return parse_scene(result.text, [f.name for f in work.figures], rendered.hash)


def parse_scene(text: str, names: Sequence[str], prompt_hash: str = "") -> Scene:
    """模型的回复 → 画面描述和画里的人（只认名单里有的名字）。"""
    payload = extract_json_object(text)
    if payload is None:
        prose = text.strip()
        if not prose:
            raise NoScene
        return Scene(prompt=prose[:MAX_PROMPT_CHARS], people=(), prompt_hash=prompt_hash)
    prompt = payload.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise NoScene
    known = {n.strip(): n for n in names}
    people: list[str] = []
    raw = payload.get("people")
    for value in raw if isinstance(raw, list) else ():
        name = known.get(str(value).strip()) if isinstance(value, str | int) else None
        if name is not None and name not in people:
            people.append(name)
    return Scene(
        prompt=prompt.strip()[:MAX_PROMPT_CHARS], people=tuple(people), prompt_hash=prompt_hash
    )
