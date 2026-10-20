"""OptionsRepair：导演没给出 2 个合格选项时，用小模型补齐（非流式，限时由调用方控制）。"""

from __future__ import annotations

import time
from collections.abc import Sequence

from bettertavern.domain.routing import RouteTask
from bettertavern.domain.story.options import OPTION_COUNT, normalize_options
from bettertavern.providers import (
    Capabilities,
    ChatRequest,
    ChatResult,
    Message,
    ProviderAdapter,
    ProviderError,
    ReasoningConfig,
    ResolvedCredential,
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
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.json_extract import extract_json_object

AGENT = "options_repair"

SPEC = AgentSpec(name=AGENT, task=RouteTask.REPAIR, output=OutputKind.STRUCTURED)


async def repair_options(
    adapter: ProviderAdapter,
    cred: ResolvedCredential,
    caps: Capabilities,
    *,
    model: str,
    prompts: PromptLibrary,
    narrative: str,
    existing: Sequence[str] = (),
    max_tokens: int = 256,
    steps: StepLog | None = None,
) -> list[str]:
    steps = steps if steps is not None else StepLog()
    prompt = prompts.render(
        "options_repair",
        narrative=sanitize_for_fence(narrative),
        existing=[sanitize_for_fence(o) for o in existing],
        count=OPTION_COUNT,
    )
    use_json_object = "json_object" in caps.structured

    async def call(
        messages: Sequence[Message], _tools: Sequence[ToolSpec] | None
    ) -> ModelReply[ChatResult]:
        request = ChatRequest(
            messages=list(messages),
            model=model,
            max_tokens=max_tokens,
            temperature=0.7,
            reasoning=ReasoningConfig(enabled=False) if caps.reasoning.control != "none" else None,
            response_format=ResponseFormat(type="json_object") if use_json_object else None,
        )
        args = {"model": model, "json_object": use_json_object}
        started = time.perf_counter()
        try:
            result = await adapter.complete(request, cred, caps)
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
        SPEC, [Message(role="user", content=prompt.text)], call, steps=steps, prompts=prompts
    )
    payload = extract_json_object(result.text)
    if payload is None:
        return []
    options = payload.get("options")
    if not isinstance(options, list):
        return []
    return normalize_options(str(o) for o in options if isinstance(o, str | int | float))
