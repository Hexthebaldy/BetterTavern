"""带抖动的指数退避与重试。

函数形态借鉴 hermes-agent 的 jittered_backoff（自行实现）。流式请求只在产出第一个
可见内容之前重试：玩家一旦看到文字，重试就会换内容。
"""

from __future__ import annotations

import asyncio
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from .base import ChatEvent, TextDelta, ToolCallDelta
from .errors import ProviderError

OnRetry = Callable[[ProviderError, int, float], None]


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    max_retries: int = 2
    base_delay: float = 1.0
    max_delay: float = 20.0
    jitter_ratio: float = 0.5
    # Retry-After 要求等待的时间超过这个值就不等了，交给 fallback 路由
    max_retry_after: float = 20.0


HOT_PATH = RetryPolicy(max_retries=2, base_delay=1.0, max_delay=20.0, max_retry_after=20.0)
BACKGROUND = RetryPolicy(max_retries=3, base_delay=5.0, max_delay=120.0, max_retry_after=120.0)


def jittered_backoff(
    attempt: int,
    *,
    base: float,
    max_delay: float,
    jitter_ratio: float = 0.5,
    rand: Callable[[], float] = random.random,
) -> float:
    """第 attempt 次重试前的等待秒数。

    d = min(base × 2^(attempt−1), max)，结果落在 [d × (1 − jitter), d] 之间。
    """
    attempt = max(attempt, 1)
    delay = min(base * (2 ** (attempt - 1)), max_delay)
    return delay * (1.0 - jitter_ratio) + delay * jitter_ratio * rand()


def retry_delay(
    error: ProviderError,
    retries_done: int,
    policy: RetryPolicy,
    *,
    rand: Callable[[], float] = random.random,
) -> float | None:
    """下一次重试前要等多久；None 表示不应在同一路由上再试。"""
    if not error.retryable:
        return None
    limit = min(policy.max_retries, error.policy.max_retries)
    if retries_done >= limit:
        return None
    if error.retry_after is not None:
        if error.retry_after > policy.max_retry_after:
            return None
        return error.retry_after
    return jittered_backoff(
        retries_done + 1,
        base=policy.base_delay,
        max_delay=policy.max_delay,
        jitter_ratio=policy.jitter_ratio,
        rand=rand,
    )


async def call_with_retry[T](
    call: Callable[[], Awaitable[T]],
    policy: RetryPolicy,
    *,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    on_retry: OnRetry | None = None,
) -> T:
    retries = 0
    while True:
        try:
            return await call()
        except ProviderError as error:
            delay = retry_delay(error, retries, policy)
            if delay is None:
                raise
            retries += 1
            if on_retry is not None:
                on_retry(error, retries, delay)
            await sleep(delay)


async def stream_with_retry(
    open_stream: Callable[[], AsyncIterator[ChatEvent]],
    policy: RetryPolicy,
    *,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    on_retry: OnRetry | None = None,
) -> AsyncIterator[ChatEvent]:
    """包一层流式调用：首个可见内容之前出错就退避重试，之后出错原样抛出（partial=True）。"""
    retries = 0
    while True:
        committed = False
        delay = 0.0
        stream = open_stream()
        try:
            async for event in stream:
                if isinstance(event, TextDelta | ToolCallDelta):
                    committed = True
                yield event
            return
        except ProviderError as error:
            if committed:
                error.partial = True
                raise
            next_delay = retry_delay(error, retries, policy)
            if next_delay is None:
                raise
            delay = next_delay
            retries += 1
            if on_retry is not None:
                on_retry(error, retries, delay)
        finally:
            aclose = getattr(stream, "aclose", None)
            if aclose is not None:
                await aclose()
        await sleep(delay)
