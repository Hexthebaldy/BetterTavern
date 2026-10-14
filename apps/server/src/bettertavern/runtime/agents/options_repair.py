"""OptionsRepair：导演没给出 2 个合格选项时，用小模型补齐（非流式，限时由调用方控制）。"""

from __future__ import annotations

from collections.abc import Sequence

from bettertavern.domain.story.options import OPTION_COUNT, normalize_options
from bettertavern.providers import (
    Capabilities,
    ChatRequest,
    Message,
    ProviderAdapter,
    ReasoningConfig,
    ResolvedCredential,
    ResponseFormat,
)
from bettertavern.runtime.context.fences import sanitize_for_fence
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.json_extract import extract_json_object


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
) -> list[str]:
    prompt = prompts.render(
        "options_repair",
        narrative=sanitize_for_fence(narrative),
        existing=[sanitize_for_fence(o) for o in existing],
        count=OPTION_COUNT,
    )
    use_json_object = "json_object" in caps.structured
    request = ChatRequest(
        messages=[Message(role="user", content=prompt.text)],
        model=model,
        max_tokens=max_tokens,
        temperature=0.7,
        reasoning=ReasoningConfig(enabled=False) if caps.reasoning.control != "none" else None,
        response_format=ResponseFormat(type="json_object") if use_json_object else None,
    )
    result = await adapter.complete(request, cred, caps)
    payload = extract_json_object(result.text)
    if payload is None:
        return []
    options = payload.get("options")
    if not isinstance(options, list):
        return []
    return normalize_options(str(o) for o in options if isinstance(o, str | int | float))
