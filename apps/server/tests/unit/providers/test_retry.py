from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from bettertavern.providers.base import ChatEvent, Done, ReasoningDelta, TextDelta
from bettertavern.providers.errors import ErrorClass, ProviderError
from bettertavern.providers.retry import (
    HOT_PATH,
    RetryPolicy,
    call_with_retry,
    jittered_backoff,
    retry_delay,
    stream_with_retry,
)

pytestmark = pytest.mark.anyio


def test_backoff_bounds() -> None:
    for attempt in range(1, 8):
        low = jittered_backoff(attempt, base=1.0, max_delay=20.0, rand=lambda: 0.0)
        high = jittered_backoff(attempt, base=1.0, max_delay=20.0, rand=lambda: 1.0)
        expected = min(2 ** (attempt - 1), 20.0)
        assert low == pytest.approx(expected * 0.5)
        assert high == pytest.approx(expected)


def test_retry_delay_respects_class_and_limits() -> None:
    overloaded = ProviderError(ErrorClass.OVERLOADED, "busy")
    assert retry_delay(overloaded, 0, HOT_PATH, rand=lambda: 1.0) == pytest.approx(1.0)
    assert retry_delay(overloaded, 1, HOT_PATH, rand=lambda: 1.0) == pytest.approx(2.0)
    assert retry_delay(overloaded, 2, HOT_PATH) is None  # 热路径最多重试 2 次
    timeout = ProviderError(ErrorClass.TIMEOUT, "slow")
    assert retry_delay(timeout, 1, HOT_PATH) is None  # timeout 类只重试 1 次
    assert retry_delay(ProviderError(ErrorClass.AUTH, "no"), 0, HOT_PATH) is None


def test_retry_after_is_honoured_unless_too_long() -> None:
    error = ProviderError(ErrorClass.RATE_LIMIT, "429", retry_after=4.0)
    assert retry_delay(error, 0, HOT_PATH) == 4.0
    error = ProviderError(ErrorClass.RATE_LIMIT, "429", retry_after=45.0)
    assert retry_delay(error, 0, HOT_PATH) is None  # 热路径不等 20 秒以上，交给 fallback


async def test_call_with_retry_retries_then_succeeds() -> None:
    attempts = 0
    sleeps: list[float] = []

    async def call() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ProviderError(ErrorClass.SERVER_ERROR, "500")
        return "ok"

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    result = await call_with_retry(call, RetryPolicy(max_retries=2), sleep=fake_sleep)
    assert result == "ok"
    assert attempts == 3
    assert len(sleeps) == 2


async def test_call_with_retry_gives_up() -> None:
    async def call() -> str:
        raise ProviderError(ErrorClass.SERVER_ERROR, "500")

    async def fake_sleep(seconds: float) -> None:
        return None

    with pytest.raises(ProviderError):
        await call_with_retry(call, RetryPolicy(max_retries=1), sleep=fake_sleep)


def scripted_streams(*scripts: list[ChatEvent | ProviderError]):
    calls = 0

    def open_stream() -> AsyncIterator[ChatEvent]:
        nonlocal calls
        script = scripts[calls]
        calls += 1

        async def gen() -> AsyncIterator[ChatEvent]:
            for item in script:
                if isinstance(item, ProviderError):
                    raise item
                yield item

        return gen()

    return open_stream, lambda: calls


async def fake_sleep(seconds: float) -> None:
    return None


async def test_stream_retries_before_first_text() -> None:
    open_stream, calls = scripted_streams(
        [ReasoningDelta("thinking"), ProviderError(ErrorClass.OVERLOADED, "busy")],
        [TextDelta("你好"), Done("stop")],
    )
    events = [e async for e in stream_with_retry(open_stream, HOT_PATH, sleep=fake_sleep)]
    assert calls() == 2
    assert events[-2:] == [TextDelta("你好"), Done("stop")]


async def test_stream_does_not_retry_after_text() -> None:
    open_stream, calls = scripted_streams(
        [TextDelta("你"), ProviderError(ErrorClass.SERVER_ERROR, "broken")],
        [TextDelta("never"), Done("stop")],
    )
    seen: list[ChatEvent] = []
    with pytest.raises(ProviderError) as info:
        async for event in stream_with_retry(open_stream, HOT_PATH, sleep=fake_sleep):
            seen.append(event)
    assert calls() == 1
    assert seen == [TextDelta("你")]
    assert info.value.partial
