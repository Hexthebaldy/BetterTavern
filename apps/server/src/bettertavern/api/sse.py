"""SSE 响应封装与 Last-Event-ID 续传。

事件 id 为 {stream_id}:{n}，n 在流内递增。每 15 秒发一次 :keepalive 注释行；
响应头关掉代理缓冲（X-Accel-Buffering: no），SSE 路由不开 gzip。
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncGenerator, AsyncIterator
from typing import Any

from starlette.responses import StreamingResponse

from bettertavern.runtime.events.buffer import StreamEvent

KEEPALIVE = b": keepalive\n\n"
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}


def encode_event(event: StreamEvent) -> bytes:
    lines = [f"id: {event.id}", f"event: {event.event}"]
    lines += [f"data: {line}" for line in event.data.split("\n")]
    return ("\n".join(lines) + "\n\n").encode()


def parse_last_event_id(value: str | None, stream_id: str) -> int:
    """'{stream_id}:{n}' → n。不属于这个流、格式不对或为空时从头开始（0）。"""
    if not value:
        return 0
    prefix, sep, number = value.strip().rpartition(":")
    if not sep or prefix != stream_id or not number.isdigit():
        return 0
    return int(number)


async def event_stream_body(
    events: AsyncIterator[StreamEvent],
    *,
    keepalive: float = 15.0,
    retry_ms: int | None = 1000,
    stop: asyncio.Event | None = None,
) -> AsyncGenerator[bytes, None]:
    """把事件流编码成 SSE 字节流。stop 置位（进程开始优雅退出）时主动结束，客户端会续传。"""
    if retry_ms is not None:
        yield f"retry: {retry_ms}\n\n".encode()
    iterator = aiter(events)
    pending: asyncio.Future[StreamEvent] = asyncio.ensure_future(anext(iterator))
    stopper: asyncio.Future[Any] | None = (
        asyncio.ensure_future(stop.wait()) if stop is not None else None
    )
    try:
        while True:
            watched: set[asyncio.Future[Any]] = {pending}
            if stopper is not None:
                watched.add(stopper)
            done, _ = await asyncio.wait(
                watched, timeout=keepalive, return_when=asyncio.FIRST_COMPLETED
            )
            if pending not in done:
                if stopper is not None and stopper in done:
                    return
                yield KEEPALIVE
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                return
            yield encode_event(event)
            pending = asyncio.ensure_future(anext(iterator))
    finally:
        if stopper is not None:
            stopper.cancel()
        pending.cancel()
        await asyncio.wait({pending})
        if not pending.cancelled():
            pending.exception()
        aclose = getattr(iterator, "aclose", None)
        if aclose is not None:
            with contextlib.suppress(RuntimeError):
                await aclose()


def sse_response(body: AsyncIterator[bytes]) -> StreamingResponse:
    return StreamingResponse(body, media_type="text/event-stream", headers=SSE_HEADERS)
