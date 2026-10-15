"""把各家千奇百怪的错误归成少数几类，类别决定动作。

类别取自 hermes-agent 的 FailoverReason 的思路（自行实现），去掉了与本项目无关的几类，
增加了 unsupported_feature（能力不支持，降级）和 stream_interrupted（流中途断开）。
"""

from __future__ import annotations

import email.utils
import json
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx


class ErrorClass(StrEnum):
    AUTH = "auth"
    BILLING = "billing"
    RATE_LIMIT = "rate_limit"
    OVERLOADED = "overloaded"
    SERVER_ERROR = "server_error"
    TIMEOUT = "timeout"
    CONNECTION = "connection"
    CONTEXT_OVERFLOW = "context_overflow"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    MODEL_NOT_FOUND = "model_not_found"
    CONTENT_POLICY_BLOCKED = "content_policy_blocked"
    FORMAT_ERROR = "format_error"
    UNSUPPORTED_FEATURE = "unsupported_feature"
    ENDPOINT_NOT_ALLOWED = "endpoint_not_allowed"
    STREAM_INTERRUPTED = "stream_interrupted"
    INVALID_RESPONSE = "invalid_response"
    CANCELLED = "cancelled"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class ErrorPolicy:
    retryable: bool  # 同一路由退避后重试
    fallback: bool  # 允许切到 fallback 路由
    max_retries: int  # 同一路由最多重试几次（不含第一次）


# 上下文超窗、格式错误、能力不支持这几类由 runtime 做专门处理（截断、换转换、降级），
# 所以这里标为不可直接重试。
_POLICIES: dict[ErrorClass, ErrorPolicy] = {
    ErrorClass.AUTH: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.BILLING: ErrorPolicy(retryable=False, fallback=True, max_retries=0),
    ErrorClass.RATE_LIMIT: ErrorPolicy(retryable=True, fallback=True, max_retries=2),
    ErrorClass.OVERLOADED: ErrorPolicy(retryable=True, fallback=True, max_retries=2),
    ErrorClass.SERVER_ERROR: ErrorPolicy(retryable=True, fallback=True, max_retries=2),
    ErrorClass.TIMEOUT: ErrorPolicy(retryable=True, fallback=True, max_retries=1),
    ErrorClass.CONNECTION: ErrorPolicy(retryable=True, fallback=True, max_retries=2),
    ErrorClass.CONTEXT_OVERFLOW: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.PAYLOAD_TOO_LARGE: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.MODEL_NOT_FOUND: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.CONTENT_POLICY_BLOCKED: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.FORMAT_ERROR: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.UNSUPPORTED_FEATURE: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.ENDPOINT_NOT_ALLOWED: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.STREAM_INTERRUPTED: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.INVALID_RESPONSE: ErrorPolicy(retryable=True, fallback=True, max_retries=1),
    ErrorClass.CANCELLED: ErrorPolicy(retryable=False, fallback=False, max_retries=0),
    ErrorClass.UNKNOWN: ErrorPolicy(retryable=True, fallback=True, max_retries=1),
}


def policy_for(error_class: ErrorClass) -> ErrorPolicy:
    return _POLICIES[error_class]


class ProviderError(Exception):
    """provider 层对外抛出的唯一异常类型。"""

    def __init__(
        self,
        error_class: ErrorClass,
        message: str,
        *,
        status: int | None = None,
        retry_after: float | None = None,
        provider: str | None = None,
        model: str | None = None,
        capability: str | None = None,
        partial: bool = False,
        body_excerpt: str | None = None,
    ) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.message = message
        self.status = status
        self.retry_after = retry_after
        self.provider = provider
        self.model = model
        self.capability = capability  # unsupported_feature 时指出是哪项能力
        self.partial = partial  # 流式请求在出错前已经产出过内容
        self.body_excerpt = body_excerpt

    @property
    def policy(self) -> ErrorPolicy:
        return policy_for(self.error_class)

    @property
    def retryable(self) -> bool:
        return self.policy.retryable and not self.partial

    @property
    def context_limit(self) -> int | None:
        """上下文超长时，服务商在报错里写的真实上限；没写就是 None。"""
        if self.error_class is not ErrorClass.CONTEXT_OVERFLOW:
            return None
        return context_limit_from(self.message)

    def __repr__(self) -> str:
        return (
            f"ProviderError({self.error_class.value!r}, {self.message!r}, status={self.status!r}, "
            f"provider={self.provider!r}, model={self.model!r})"
        )


class EndpointNotAllowed(ProviderError):
    """端点没通过 SSRF 校验。"""

    def __init__(self, reason: str) -> None:
        super().__init__(ErrorClass.ENDPOINT_NOT_ALLOWED, reason)
        self.reason = reason


_CONTEXT_PATTERNS = (
    "context length",
    "context_length",
    "maximum context",
    "context window",
    "too many tokens",
    "prompt is too long",
    "input is too long",
    "reduce the length",
    "exceeds the model",
    "maximum input",
    "input length",
    "token limit",
    "tokens exceed",
    "`max_new_tokens` must be",  # TGI
)
_MODEL_PATTERNS = (
    "model not found",
    "model_not_found",
    "model not exist",
    "model does not exist",
    "unknown model",
    "invalid model",
    "no such model",
    "not a valid model",
)
_CONTENT_PATTERNS = (
    "content_filter",
    "content policy",
    "content_policy",
    "content management policy",
    "moderation",
    "safety",
    "inappropriate",
    "sensitive",
)
_BILLING_PATTERNS = (
    "insufficient_quota",
    "insufficient quota",
    "insufficient balance",
    "insufficient_balance",
    "exceeded your current quota",
    "billing",
    "payment required",
    "credit",
)
_UNSUPPORTED_PATTERNS = (
    "not supported",
    "unsupported",
    "does not support",
    "not support",
    "unrecognized request argument",
    "unknown parameter",
    "unexpected keyword",
    "extra inputs are not permitted",
)
_FORMAT_PATTERNS = (
    "alternat",
    "roles must",
    "role must",
    "invalid role",
    "conversation roles",
    "first message",
    "last message",
)
_CAPABILITY_HINTS = (
    ("json_schema", "json_schema"),
    ("response_format", "json_object"),
    ("tool_choice", "tool_call"),
    ("tools", "tool_call"),
    ("function", "tool_call"),
    ("thinking", "reasoning"),
    ("reasoning", "reasoning"),
    ("stream_options", "stream_usage"),
    ("system", "system_role"),
)


# 各家“上下文超长”报错里写上限的方式，例如
#   vLLM / OpenAI：This model's maximum context length is 32768 tokens. However, you requested ...
#   TGI：`inputs` tokens + `max_new_tokens` must be <= 8192
#   其他：context window of 131072 tokens、limit of 65536 tokens
_CONTEXT_LIMIT_PATTERNS = (
    re.compile(r"maximum context length (?:is|of) (\d[\d,]*)"),
    re.compile(r"context (?:length|window) (?:is|of) (\d[\d,]*)"),
    re.compile(r"max_new_tokens`? must be <= ?(\d[\d,]*)"),
    re.compile(r"(?:limit|maximum) of (\d[\d,]*) tokens"),
)
_MIN_CONTEXT_LIMIT = 1024
_MAX_CONTEXT_LIMIT = 10_000_000


def context_limit_from(text: str) -> int | None:
    """从超长报错的文字里找出模型的上下文上限；找不到或数值不合理时返回 None。"""
    lowered = text.lower()
    for pattern in _CONTEXT_LIMIT_PATTERNS:
        match = pattern.search(lowered)
        if match is None:
            continue
        value = int(match.group(1).replace(",", ""))
        if _MIN_CONTEXT_LIMIT <= value <= _MAX_CONTEXT_LIMIT:
            return value
    return None


def _contains(text: str, patterns: tuple[str, ...]) -> bool:
    return any(p in text for p in patterns)


def extract_error_text(body: str | bytes | Mapping[str, Any] | None) -> str:
    """从各家错误体里取出可读的错误信息（message、code、type 拼在一起）。"""
    if body is None:
        return ""
    obj: Any
    if isinstance(body, Mapping):
        obj = body
    else:
        raw = body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body
        try:
            obj = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return raw.strip()[:2000]
    parts: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, Mapping):
            for key in ("message", "code", "type", "param", "detail", "error"):
                if key in value:
                    collect(value[key])
        elif isinstance(value, list):
            for item in value[:5]:
                collect(item)

    collect(obj)
    return " ".join(p for p in parts if p)[:2000]


def parse_retry_after(headers: Mapping[str, str] | httpx.Headers | None) -> float | None:
    if not headers:
        return None
    ms = headers.get("retry-after-ms")
    if ms:
        try:
            return max(float(ms) / 1000.0, 0.0)
        except ValueError:
            pass
    value = headers.get("retry-after")
    if not value:
        return None
    try:
        return max(float(value), 0.0)
    except ValueError:
        pass
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    return max(parsed.timestamp() - time.time(), 0.0)


def _capability_hint(text: str) -> str | None:
    for needle, capability in _CAPABILITY_HINTS:
        if needle in text:
            return capability
    return None


def classify_http_error(
    status: int,
    body: str | bytes | Mapping[str, Any] | None,
    headers: Mapping[str, str] | httpx.Headers | None = None,
    *,
    provider: str | None = None,
    model: str | None = None,
) -> ProviderError:
    """HTTP 状态码加错误体 → ProviderError。"""
    message = extract_error_text(body)
    text = message.lower()
    retry_after = parse_retry_after(headers)

    def make(error_class: ErrorClass, capability: str | None = None) -> ProviderError:
        return ProviderError(
            error_class,
            message or f"HTTP {status}",
            status=status,
            retry_after=retry_after,
            provider=provider,
            model=model,
            capability=capability,
            body_excerpt=message[:500] or None,
        )

    if status in (401, 403):
        return make(ErrorClass.AUTH)
    if status == 402:
        return make(ErrorClass.BILLING)
    if status == 429:
        if _contains(text, _BILLING_PATTERNS):
            return make(ErrorClass.BILLING)
        return make(ErrorClass.RATE_LIMIT)
    if status == 413:
        return make(ErrorClass.PAYLOAD_TOO_LARGE)
    if status == 404:
        return make(ErrorClass.MODEL_NOT_FOUND)
    if status in (400, 422):
        if _contains(text, _CONTEXT_PATTERNS):
            return make(ErrorClass.CONTEXT_OVERFLOW)
        if _contains(text, _MODEL_PATTERNS):
            return make(ErrorClass.MODEL_NOT_FOUND)
        if _contains(text, _CONTENT_PATTERNS):
            return make(ErrorClass.CONTENT_POLICY_BLOCKED)
        if _contains(text, _BILLING_PATTERNS):
            return make(ErrorClass.BILLING)
        if _contains(text, _UNSUPPORTED_PATTERNS):
            return make(ErrorClass.UNSUPPORTED_FEATURE, _capability_hint(text))
        if _contains(text, _FORMAT_PATTERNS):
            return make(ErrorClass.FORMAT_ERROR)
        return make(ErrorClass.UNKNOWN)
    if status in (503, 529) or "overloaded" in text:
        return make(ErrorClass.OVERLOADED)
    if 500 <= status < 600:
        return make(ErrorClass.SERVER_ERROR)
    if 300 <= status < 400:
        error = make(ErrorClass.INVALID_RESPONSE)
        error.message = f"端点返回了重定向（HTTP {status}），请检查基址"
        return error
    return make(ErrorClass.UNKNOWN)


def classify_stream_error(
    payload: Mapping[str, Any],
    *,
    provider: str | None = None,
    model: str | None = None,
    partial: bool = False,
) -> ProviderError:
    """流中途收到的 {"error": ...} 数据块。没有状态码，只能按文字判断。"""
    message = extract_error_text(payload)
    text = message.lower()
    if _contains(text, _CONTEXT_PATTERNS):
        error_class = ErrorClass.CONTEXT_OVERFLOW
    elif _contains(text, _CONTENT_PATTERNS):
        error_class = ErrorClass.CONTENT_POLICY_BLOCKED
    elif "rate limit" in text or "too many requests" in text:
        error_class = ErrorClass.RATE_LIMIT
    elif "overloaded" in text:
        error_class = ErrorClass.OVERLOADED
    else:
        error_class = ErrorClass.SERVER_ERROR
    return ProviderError(
        error_class,
        message or "上游在流中途返回了错误",
        provider=provider,
        model=model,
        partial=partial,
        body_excerpt=message[:500] or None,
    )


def classify_exception(
    exc: BaseException,
    *,
    provider: str | None = None,
    model: str | None = None,
    partial: bool = False,
) -> ProviderError:
    """httpx 等底层异常 → ProviderError。"""
    if isinstance(exc, ProviderError):
        return exc
    if isinstance(exc, httpx.TimeoutException):
        error_class = ErrorClass.STREAM_INTERRUPTED if partial else ErrorClass.TIMEOUT
        message = "等待上游超时"
    elif isinstance(exc, httpx.ConnectError):
        error_class = ErrorClass.CONNECTION
        message = f"无法连接到端点：{exc}"
    elif isinstance(exc, httpx.RemoteProtocolError | httpx.ReadError | httpx.WriteError):
        error_class = ErrorClass.STREAM_INTERRUPTED if partial else ErrorClass.CONNECTION
        message = f"连接中断：{exc}"
    elif isinstance(exc, httpx.HTTPError):
        error_class = ErrorClass.CONNECTION
        message = str(exc) or type(exc).__name__
    else:
        error_class = ErrorClass.UNKNOWN
        message = str(exc) or type(exc).__name__
    return ProviderError(error_class, message, provider=provider, model=model, partial=partial)
