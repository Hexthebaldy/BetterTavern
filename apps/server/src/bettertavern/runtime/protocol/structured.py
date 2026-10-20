"""结构化输出阶梯：json_schema → tool_call → json_object → prompt_json，按能力表选第一个可用的。

所有阶梯的输出都经 pydantic 校验。校验失败：带错误信息在同一级重试 1 次；仍失败就降一级再试 1 次，
并把该凭据加模型的这一级记入负缓存（1 小时）。厂商明确报“不支持”时直接降级并记负缓存。
每次请求都记成 `steps` 里的一步（docs/agent-runtime.md 第 5 节“记录与重放”）。
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
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
from bettertavern.runtime.agent.steps import StepLog, clip_text
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


def schema_of(model: type[BaseModel], notes: Mapping[str, str] | None = None) -> dict[str, Any]:
    """模型的 JSON Schema。notes 是按这一局语言的字段说明（"模型名.字段名" → 说明），
    取自 runtime/prompts/<lang>/schema/<name>.json；加进去后键照 pydantic 的习惯按字母排。"""
    schema = model.model_json_schema()
    for key, text in (notes or {}).items():
        owner, _, field_name = key.partition(".")
        holder = schema if owner == schema.get("title") else schema.get("$defs", {}).get(owner)
        properties = holder.get("properties", {}) if holder else {}
        if field_name in properties:
            properties[field_name] = dict(
                sorted({**properties[field_name], "description": text}.items())
            )
    return schema


def schema_text(model: type[BaseModel], notes: Mapping[str, str] | None = None) -> str:
    return json.dumps(schema_of(model, notes), ensure_ascii=False, indent=1)


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
            parts.append(f"{loc or '(root)'}: {err.get('msg', '')}")
        return "; ".join(parts)
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
    schema_notes: Mapping[str, str] | None = None,
    max_tokens: int,
    temperature: float | None,
    reasoning: ReasoningConfig | None,
    negative_cache: NegativeCapabilityCache | None = None,
    cancel: CancelToken | None = None,
    steps: StepLog | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> StructuredResult[T]:
    disabled: frozenset[str] = (
        negative_cache.disabled(cred.credential_id, model) if negative_cache else frozenset()
    )
    ladder = caps.structured_ladder(disabled)
    schema = schema_of(output, schema_notes)
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
            step_args = {"model": model, "mode": mode, "attempt": attempts}
            call_started = clock()
            try:
                result = await adapter.complete(request, cred, caps, cancel=cancel)
            except ProviderError as exc:
                if steps is not None:
                    steps.model(
                        args=step_args,
                        result={"error": exc.error_class.value, "status": exc.status},
                        latency_ms=int((clock() - call_started) * 1000),
                    )
                if exc.error_class is ErrorClass.UNSUPPORTED_FEATURE and mode != "prompt_json":
                    last_error = f"{mode} not supported: {exc.message[:120]}"
                    unsupported = True
                    break
                raise
            call_ms = int((clock() - call_started) * 1000)
            usage = _merge_usage(usage, result.usage)
            if mode == "tool_call":
                call = next((c for c in result.tool_calls if c.name == name), None)
                raw = call.arguments if call is not None else result.text
            else:
                raw = result.text
            try:
                data = extract_json_object(raw) if mode != "tool_call" else json.loads(raw)
                if data is None:
                    raise ValueError("no JSON object found")
                value = output.model_validate(data)
            except (ValidationError, ValueError) as exc:
                last_error = _error_summary(exc)
                if steps is not None:
                    steps.model(
                        args=step_args,
                        result={"text": clip_text(raw), "invalid": last_error},
                        latency_ms=call_ms,
                        usage=result.usage,
                    )
                retry = prompts.render("structured_retry", error=last_error)
                messages = [
                    *messages,
                    Message(role="assistant", content=raw[:4000]),
                    Message(role="user", content=retry.text),
                ]
                continue
            if steps is not None:
                steps.model(
                    args=step_args,
                    result={"text": clip_text(raw)},
                    latency_ms=call_ms,
                    usage=result.usage,
                )
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
        f"Structured output failed ({attempts} attempts)", attempts=attempts, last_error=last_error
    )
