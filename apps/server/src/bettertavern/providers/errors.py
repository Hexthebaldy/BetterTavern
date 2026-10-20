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


# 过一会儿再试有可能成功的错误类别：服务商那边一时的问题（请求太多、太忙、服务器出错、超时、
# 连不上、返回内容坏了）。代码不会自己重试，这个标记只告诉调用方要不要让用户再试一次
_RETRYABLE: frozenset[ErrorClass] = frozenset(
    {
        ErrorClass.RATE_LIMIT,
        ErrorClass.OVERLOADED,
        ErrorClass.SERVER_ERROR,
        ErrorClass.TIMEOUT,
        ErrorClass.CONNECTION,
        ErrorClass.INVALID_RESPONSE,
        ErrorClass.UNKNOWN,
    }
)


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
    def retryable(self) -> bool:
        """再试一次可能成功：类别是一时的问题，并且还没有产出过内容"""
        return self.error_class in _RETRYABLE and not self.partial

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
    # Gemini：The input token count (N) exceeds the maximum number of tokens allowed (M)
    "input token count",
    "context is too long",  # Gemini 的 500：Your input context is too long
)
# 有的服务商（Gemini）Key 无效时回 400 而不是 401
_AUTH_PATTERNS = (
    "api key not valid",
    "api_key_invalid",
    "api key expired",
    "api_key_expired",
    "reported as leaked",
)
# 服务商不对服务器所在的地区开放（Gemini 不对中国大陆、香港、澳门开放）：并进“服务商的其他错误”。
# 先认出来，免得文字里的 not supported、billing 把它归成“模型不支持某功能”或“额度不足”
_REGION_PATTERNS = (
    "location is not supported",
    "not available in your country",
    "not available in your region",
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
    re.compile(r"maximum number of tokens allowed \(?(\d[\d,]*)"),  # Gemini
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
        if _contains(text, _AUTH_PATTERNS):
            return make(ErrorClass.AUTH)
        if _contains(text, _REGION_PATTERNS):
            return make(ErrorClass.UNKNOWN)
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
    if 500 <= status < 600 and _contains(text, _CONTEXT_PATTERNS):
        return make(ErrorClass.CONTEXT_OVERFLOW)
    if status in (503, 529) or "overloaded" in text:
        return make(ErrorClass.OVERLOADED)
    if 500 <= status < 600:
        return make(ErrorClass.SERVER_ERROR)
    if 300 <= status < 400:
        error = make(ErrorClass.INVALID_RESPONSE)
        error.message = f"The endpoint returned a redirect (HTTP {status}); check the base URL"
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
        message or "The upstream returned an error mid-stream",
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
        message = "Timed out waiting for the upstream"
    elif isinstance(exc, httpx.ConnectError):
        error_class = ErrorClass.CONNECTION
        message = f"Can't connect to the endpoint: {exc}"
    elif isinstance(exc, httpx.RemoteProtocolError | httpx.ReadError | httpx.WriteError):
        error_class = ErrorClass.STREAM_INTERRUPTED if partial else ErrorClass.CONNECTION
        message = f"Connection interrupted: {exc}"
    elif isinstance(exc, httpx.HTTPError):
        error_class = ErrorClass.CONNECTION
        message = str(exc) or type(exc).__name__
    else:
        error_class = ErrorClass.UNKNOWN
        message = str(exc) or type(exc).__name__
    return ProviderError(error_class, message, provider=provider, model=model, partial=partial)
