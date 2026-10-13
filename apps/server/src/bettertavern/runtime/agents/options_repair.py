"""OptionsRepair：导演没给出 2 个合格选项时，用小模型补齐（非流式，限时由调用方控制）。"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

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

_FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def extract_json_object(text: str) -> dict[str, Any] | None:
    """宽松提取：去掉 markdown 围栏，取第一个完整的 JSON 对象。"""
    fenced = _FENCED_JSON.search(text)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    while start != -1:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(candidate)):
            char = candidate[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
            elif char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        value = json.loads(candidate[start : index + 1])
                    except json.JSONDecodeError:
                        break
                    return value if isinstance(value, dict) else None
        start = candidate.find("{", start + 1)
    return None


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
