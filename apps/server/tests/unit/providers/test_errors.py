from __future__ import annotations

import email.utils
import time

import httpx
import pytest

from bettertavern.providers.errors import (
    ErrorClass,
    classify_exception,
    classify_http_error,
    classify_stream_error,
    extract_error_text,
    parse_retry_after,
)


def openai_error(message: str, code: str | None = None) -> dict[str, object]:
    return {"error": {"message": message, "type": "invalid_request_error", "code": code}}


@pytest.mark.parametrize(
    ("status", "body", "expected"),
    [
        (401, openai_error("Authentication Fails"), ErrorClass.AUTH),
        (403, "forbidden", ErrorClass.AUTH),
        (402, openai_error("Insufficient Balance"), ErrorClass.BILLING),
        (429, openai_error("Rate limit reached"), ErrorClass.RATE_LIMIT),
        (
            429,
            openai_error("You exceeded your current quota", "insufficient_quota"),
            ErrorClass.BILLING,
        ),
        (413, "", ErrorClass.PAYLOAD_TOO_LARGE),
        (404, openai_error("Not Found"), ErrorClass.MODEL_NOT_FOUND),
        (
            400,
            openai_error("This model's maximum context length is 131072 tokens"),
            ErrorClass.CONTEXT_OVERFLOW,
        ),
        (400, openai_error("Model Not Exist"), ErrorClass.MODEL_NOT_FOUND),
        (
            400,
            openai_error("Content Exists Risk: content_filter"),
            ErrorClass.CONTENT_POLICY_BLOCKED,
        ),
        (
            400,
            openai_error("response_format type json_schema is not supported"),
            ErrorClass.UNSUPPORTED_FEATURE,
        ),
        (
            400,
            openai_error("Conversation roles must alternate user/assistant/user/assistant"),
            ErrorClass.FORMAT_ERROR,
        ),
        (400, openai_error("something odd"), ErrorClass.UNKNOWN),
        (503, "Service Unavailable", ErrorClass.OVERLOADED),
        (529, "", ErrorClass.OVERLOADED),
        (500, "internal", ErrorClass.SERVER_ERROR),
        (502, "bad gateway", ErrorClass.SERVER_ERROR),
        (302, "", ErrorClass.INVALID_RESPONSE),
    ],
)
def test_classify_http_error(status: int, body: object, expected: ErrorClass) -> None:
    error = classify_http_error(status, body, provider="deepseek", model="m")  # type: ignore[arg-type]
    assert error.error_class is expected
    assert error.status == status
    assert error.provider == "deepseek"


def test_unsupported_feature_names_the_capability() -> None:
    error = classify_http_error(400, openai_error("json_schema response_format is not supported"))
    assert error.capability == "json_schema"
    error = classify_http_error(400, openai_error("tool_choice is not supported for this model"))
    assert error.capability == "tool_call"
    error = classify_http_error(
        400, openai_error("Unrecognized request argument supplied: thinking")
    )
    assert error.error_class is ErrorClass.UNSUPPORTED_FEATURE
    assert error.capability == "reasoning"


def test_retry_after_variants() -> None:
    assert parse_retry_after({"retry-after": "7"}) == 7.0
    assert parse_retry_after({"retry-after-ms": "1500"}) == 1.5
    future = email.utils.formatdate(time.time() + 30, usegmt=True)
    value = parse_retry_after({"retry-after": future})
    assert value is not None and 25 <= value <= 31
    assert parse_retry_after({"retry-after": "soon"}) is None
    assert parse_retry_after(None) is None


def test_rate_limit_carries_retry_after_and_policy() -> None:
    error = classify_http_error(429, "slow down", httpx.Headers({"Retry-After": "3"}))
    assert error.retry_after == 3.0
    assert error.retryable
    assert error.policy.fallback


def test_extract_error_text_handles_shapes() -> None:
    assert "bad key" in extract_error_text({"error": {"message": "bad key", "code": "401"}})
    assert extract_error_text('{"error": "plain string"}') == "plain string"
    assert extract_error_text(b"not json") == "not json"
    assert extract_error_text({"detail": [{"msg": "x"}]}) == ""


def test_stream_error_chunk() -> None:
    error = classify_stream_error({"error": {"message": "Server overloaded"}}, partial=True)
    assert error.error_class is ErrorClass.OVERLOADED
    assert error.partial
    assert not error.retryable  # 已经产出过内容就不能重试


def test_classify_exception() -> None:
    request = httpx.Request("POST", "https://example.com")
    assert (
        classify_exception(httpx.ReadTimeout("t", request=request)).error_class
        is ErrorClass.TIMEOUT
    )
    assert (
        classify_exception(httpx.ReadTimeout("t", request=request), partial=True).error_class
        is ErrorClass.STREAM_INTERRUPTED
    )
    assert (
        classify_exception(httpx.ConnectError("refused", request=request)).error_class
        is ErrorClass.CONNECTION
    )
    assert (
        classify_exception(
            httpx.RemoteProtocolError("peer closed", request=request), partial=True
        ).error_class
        is ErrorClass.STREAM_INTERRUPTED
    )
    assert classify_exception(ValueError("x")).error_class is ErrorClass.UNKNOWN
