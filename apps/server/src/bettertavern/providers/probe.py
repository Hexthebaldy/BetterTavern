"""能力探测：对指定模型发 4 到 5 个极小请求，确认它实际支持哪些能力。

结果写入 credentials.probed[model]，7 天有效；它不是永久真相，线上遇到“不支持”还会走负缓存降级。
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from .base import (
    ChatRequest,
    ForcedTool,
    Message,
    ProviderAdapter,
    ReasoningConfig,
    ResolvedCredential,
    ResponseFormat,
    TextDelta,
    ToolSpec,
    UsageEvent,
)
from .capabilities import Capabilities
from .errors import ErrorClass, ProviderError

# 这几类错误说明凭据、模型或端点本身有问题，后面的检查没必要再做
_FATAL = frozenset(
    {
        ErrorClass.AUTH,
        ErrorClass.BILLING,
        ErrorClass.MODEL_NOT_FOUND,
        ErrorClass.ENDPOINT_NOT_ALLOWED,
        ErrorClass.CONNECTION,
    }
)

_OK_SCHEMA: Mapping[str, Any] = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}

STRUCTURED_CHECKS = ("json_schema", "tool_call", "json_object")


@dataclass(frozen=True, slots=True)
class ProbeCheck:
    name: str
    ok: bool | None  # None 表示没有测（前面的检查已经说明凭据或端点不可用）
    detail: str = ""
    latency_ms: int | None = None


@dataclass(frozen=True, slots=True)
class ProbeReport:
    provider: str
    model: str
    probed_at: str
    checks: tuple[ProbeCheck, ...]
    fatal_error: str | None = None

    def check(self, name: str) -> ProbeCheck | None:
        return next((c for c in self.checks if c.name == name), None)

    def caps_overlay(self) -> dict[str, Any]:
        """转成能力表的覆盖层：只包含真正测过的项。"""
        overlay: dict[str, Any] = {}
        structured_checks = [self.check(name) for name in STRUCTURED_CHECKS]
        if any(c is not None and c.ok is not None for c in structured_checks):
            overlay["structured"] = [
                c.name for c in structured_checks if c is not None and c.ok is True
            ]
        usage = self.check("stream_usage")
        if usage is not None and usage.ok is not None:
            overlay["stream_usage"] = usage.ok
        return overlay

    def to_json(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "probed_at": self.probed_at,
            "fatal_error": self.fatal_error,
            "checks": [
                {"name": c.name, "ok": c.ok, "detail": c.detail, "latency_ms": c.latency_ms}
                for c in self.checks
            ],
            "caps_overlay": self.caps_overlay(),
        }


@dataclass
class _Run:
    adapter: ProviderAdapter
    cred: ResolvedCredential
    model: str
    caps: Capabilities
    clock: Callable[[], float]
    checks: list[ProbeCheck] = field(default_factory=list)
    fatal: ProviderError | None = None

    def base_request(self, **kwargs: Any) -> ChatRequest:
        reasoning = (
            ReasoningConfig(enabled=False) if self.caps.reasoning.control != "none" else None
        )
        defaults: dict[str, Any] = {
            "model": self.model,
            "max_tokens": 64,
            "temperature": 0.0,
            "reasoning": reasoning,
        }
        defaults.update(kwargs)
        return ChatRequest(**defaults)

    def record(self, name: str, ok: bool | None, detail: str, started: float | None) -> None:
        latency = None if started is None else int((self.clock() - started) * 1000)
        self.checks.append(ProbeCheck(name=name, ok=ok, detail=detail, latency_ms=latency))

    def failed(self, name: str, error: ProviderError, started: float) -> None:
        self.record(name, False, f"{error.error_class.value}: {error.message[:200]}", started)
        if error.error_class in _FATAL:
            self.fatal = error


async def _check_stream(run: _Run) -> None:
    started = run.clock()
    request = run.base_request(
        messages=[Message(role="user", content="Reply with the single word: OK")]
    )
    caps = run.caps
    for attempt in range(2):
        got_text = got_usage = False
        try:
            async for event in run.adapter.stream(request, run.cred, caps):
                if isinstance(event, TextDelta):
                    got_text = True
                elif isinstance(event, UsageEvent):
                    got_usage = True
        except ProviderError as error:
            if (
                attempt == 0
                and error.error_class is ErrorClass.UNSUPPORTED_FEATURE
                and caps.stream_usage
            ):
                caps = replace(caps, stream_usage=False)  # 后端不认 stream_options，去掉再试
                continue
            run.failed("stream", error, started)
            return
        run.record("stream", True, "收到文字" if got_text else "流正常结束但没有文字", started)
        if caps.stream_usage:
            run.record(
                "stream_usage", got_usage, "流里带 usage" if got_usage else "流里没有 usage", None
            )
        else:
            run.record("stream_usage", False, "后端不支持 stream_options", None)
        return


def _json_ok(text: str) -> bool:
    try:
        data = json.loads(text.strip().removeprefix("```json").removesuffix("```").strip())
    except json.JSONDecodeError:
        return False
    return isinstance(data, dict) and isinstance(data.get("ok"), bool)


async def _check_structured(run: _Run, name: str) -> None:
    started = run.clock()
    messages = [
        Message(role="system", content="You are a test endpoint. Answer with JSON only."),
        Message(role="user", content='Return the JSON object {"ok": true}.'),
    ]
    if name == "json_object":
        request = run.base_request(
            messages=messages, response_format=ResponseFormat(type="json_object")
        )
    elif name == "json_schema":
        request = run.base_request(
            messages=messages,
            response_format=ResponseFormat(type="json_schema", schema=_OK_SCHEMA, name="probe"),
        )
    else:
        request = run.base_request(
            messages=[Message(role="user", content="Call the report tool with ok=true.")],
            tools=[ToolSpec(name="report", description="Report a status.", parameters=_OK_SCHEMA)],
            tool_choice=ForcedTool("report"),
        )
    try:
        result = await run.adapter.complete(request, run.cred, run.caps)
    except ProviderError as error:
        run.failed(name, error, started)
        return
    if name == "tool_call":
        call = next((c for c in result.tool_calls if c.name == "report"), None)
        ok = call is not None and _json_ok(call.arguments)
        run.record(name, ok, "返回了合法的工具调用" if ok else "没有返回合法的工具调用", started)
    else:
        ok = _json_ok(result.text)
        run.record(name, ok, "返回了合法的 JSON" if ok else "返回内容不是要求的 JSON", started)


async def _check_reasoning_toggle(run: _Run) -> None:
    started = run.clock()
    request = run.base_request(messages=[Message(role="user", content="Reply with: OK")])
    try:
        await run.adapter.complete(request, run.cred, run.caps)
    except ProviderError as error:
        run.failed("reasoning_toggle", error, started)
        return
    run.record("reasoning_toggle", True, "可以关闭思考", started)


async def probe_model(
    adapter: ProviderAdapter,
    cred: ResolvedCredential,
    model: str,
    caps: Capabilities,
    *,
    clock: Callable[[], float] = time.perf_counter,
) -> ProbeReport:
    run = _Run(adapter=adapter, cred=cred, model=model, caps=caps, clock=clock)
    steps: list[tuple[str, Callable[[], Any]]] = [
        ("stream", lambda: _check_stream(run)),
        ("json_object", lambda: _check_structured(run, "json_object")),
        ("json_schema", lambda: _check_structured(run, "json_schema")),
        ("tool_call", lambda: _check_structured(run, "tool_call")),
    ]
    if caps.reasoning.control != "none":
        steps.append(("reasoning_toggle", lambda: _check_reasoning_toggle(run)))
    for name, step in steps:
        if run.fatal is not None:
            run.record(name, None, "未测：凭据、模型或端点不可用", None)
            continue
        await step()
    return ProbeReport(
        provider=adapter.profile.id,
        model=model,
        probed_at=datetime.now(UTC).isoformat(timespec="seconds"),
        checks=tuple(run.checks),
        fatal_error=(
            None if run.fatal is None else f"{run.fatal.error_class.value}: {run.fatal.message}"
        ),
    )
