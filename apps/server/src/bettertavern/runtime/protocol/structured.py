"""结构化输出阶梯：json_schema → tool_call → json_object → prompt_json，按能力表选第一个可用的。

所有阶梯的输出都经 pydantic 校验。校验失败：带错误信息在同一级重试 1 次；仍失败就降一级再试 1 次，
并把该凭据加模型的这一级记入负缓存（1 小时）。厂商明确报“不支持”时直接降级并记负缓存。
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from bettertavern.providers import (
    CancelToken,
    Capabilities,
    ChatRequest,
    ForcedTool,
    Message,
    NegativeCapabilityCache,
    ProviderAdapter,
    ProviderError,
    ReasoningConfig,
    ResolvedCredential,
    ResponseFormat,
    ToolSpec,
    Usage,
)
from bettertavern.providers.capabilities import StructuredMode
from bettertavern.providers.errors import ErrorClass
from bettertavern.runtime.prompts import PromptLibrary
from bettertavern.runtime.protocol.json_extract import extract_json_object

MessageBuilder = Callable[[StructuredMode], list[Message]]


class StructuredOutputError(Exception):
    def __init__(self, message: str, *, attempts: int, last_error: str) -> None:
        super().__init__(message)
        self.attempts = attempts
        self.last_error = last_error


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    value: T
    mode: StructuredMode
    usage: Usage | None
    attempts: int
    latency_ms: int


def schema_of(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema()


def schema_text(model: type[BaseModel]) -> str:
    return json.dumps(schema_of(model), ensure_ascii=False, indent=1)


def _merge_usage(a: Usage | None, b: Usage | None) -> Usage | None:
    if a is None:
        return b
    if b is None:
        return a
    return Usage(
        prompt=a.prompt + b.prompt,
        completion=a.completion + b.completion,
        cached=a.cached + b.cached,
        reasoning=a.reasoning + b.reasoning,
    )


def _error_summary(exc: ValidationError | ValueError) -> str:
    if isinstance(exc, ValidationError):
        parts = []
        for err in exc.errors()[:6]:
            loc = ".".join(str(p) for p in err.get("loc", ()))
            parts.append(f"{loc or '(根)'}: {err.get('msg', '')}")
        return "；".join(parts)
    return str(exc)[:300]


async def run_structured[T: BaseModel](
    adapter: ProviderAdapter,
    cred: ResolvedCredential,
    caps: Capabilities,
    *,
    model: str,
    output: type[T],
    name: str,
    description: str,
    build_messages: MessageBuilder,
    prompts: PromptLibrary,
    max_tokens: int,
    temperature: float | None,
    reasoning: ReasoningConfig | None,
    negative_cache: NegativeCapabilityCache | None = None,
    cancel: CancelToken | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> StructuredResult[T]:
    disabled: frozenset[str] = (
        negative_cache.disabled(cred.credential_id, model) if negative_cache else frozenset()
    )
    ladder = caps.structured_ladder(disabled)
    schema = schema_of(output)
    started = clock()
    attempts = 0
    usage: Usage | None = None
    last_error = ""
    levels_used = 0  # 真正产出过内容（校验没过）的级数；厂商报“不支持”的级不计
    for mode in ladder:
        if levels_used >= 2:
            break
        tries = 2 if levels_used == 0 else 1
        messages = build_messages(mode)
        unsupported = False
        for _ in range(tries):
            attempts += 1
            request = ChatRequest(
                messages=messages,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                reasoning=reasoning,
                response_format=(
                    ResponseFormat(type="json_schema", schema=schema, name=name, strict=False)
                    if mode == "json_schema"
                    else ResponseFormat(type="json_object")
                    if mode == "json_object"
                    else None
                ),
                tools=(
                    [ToolSpec(name=name, description=description, parameters=schema)]
                    if mode == "tool_call"
                    else None
                ),
                tool_choice=ForcedTool(name) if mode == "tool_call" else None,
            )
            try:
                result = await adapter.complete(request, cred, caps, cancel=cancel)
            except ProviderError as exc:
                if exc.error_class is ErrorClass.UNSUPPORTED_FEATURE and mode != "prompt_json":
                    last_error = f"{mode} 不支持：{exc.message[:120]}"
                    unsupported = True
                    break
                raise
            usage = _merge_usage(usage, result.usage)
            if mode == "tool_call":
                call = next((c for c in result.tool_calls if c.name == name), None)
                raw = call.arguments if call is not None else result.text
            else:
                raw = result.text
            try:
                data = extract_json_object(raw) if mode != "tool_call" else json.loads(raw)
                if data is None:
                    raise ValueError("没有找到 JSON 对象")
                value = output.model_validate(data)
            except (ValidationError, ValueError) as exc:
                last_error = _error_summary(exc)
                retry = prompts.render("structured_retry", error=last_error)
                messages = [
                    *messages,
                    Message(role="assistant", content=raw[:4000]),
                    Message(role="user", content=retry.text),
                ]
                continue
            return StructuredResult(
                value=value,
                mode=mode,
                usage=usage,
                attempts=attempts,
                latency_ms=int((clock() - started) * 1000),
            )
        # 这一级不支持或校验一直不过：记入负缓存，降一级
        if negative_cache is not None and mode != "prompt_json":
            negative_cache.add(cred.credential_id, model, mode)
        if not unsupported:
            levels_used += 1
    raise StructuredOutputError(
        f"结构化输出失败（{attempts} 次尝试）", attempts=attempts, last_error=last_error
    )
