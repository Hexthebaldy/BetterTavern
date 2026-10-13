"""事件缓冲：生成与连接解耦的关键。

生成方只管往流里发布事件；订阅方从任意位置开始读（断线重连带 Last-Event-ID）。
单实例用这个进程内缓冲，多实例时换成 Redis Streams。流结束后保留一段时间（默认 10 分钟），
过期后客户端续传拿不到增量，由上层改发 snapshot 事件。
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class StreamEvent:
    stream_id: str
    seq: int  # 从 1 开始，在流内递增
    event: str
    data: str  # JSON 文本

    @property
    def id(self) -> str:
        return f"{self.stream_id}:{self.seq}"


class StreamClosed(Exception):
    pass


class EventStream:
    def __init__(
        self,
        stream_id: str,
        *,
        max_events: int = 100_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.stream_id = stream_id
        self._events: list[StreamEvent] = []
        self._max_events = max_events
        self._closed = False
        self._condition = asyncio.Condition()
        self._clock = clock
        self.created_at = clock()
        self.closed_at: float | None = None

    @property
    def closed(self) -> bool:
        return self._closed

    @property
    def last_seq(self) -> int:
        return len(self._events)

    async def publish(self, event: str, data: Mapping[str, Any] | str) -> StreamEvent:
        if self._closed:
            raise StreamClosed(self.stream_id)
        if len(self._events) >= self._max_events:
            raise OverflowError(f"事件流 {self.stream_id} 超过 {self._max_events} 个事件")
        payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        item = StreamEvent(self.stream_id, len(self._events) + 1, event, payload)
        async with self._condition:
            self._events.append(item)
            self._condition.notify_all()
        return item

    async def close(self) -> None:
        if self._closed:
            return
        async with self._condition:
            self._closed = True
            self.closed_at = self._clock()
            self._condition.notify_all()

    def snapshot(self, after_seq: int = 0) -> list[StreamEvent]:
        return self._events[max(after_seq, 0) :]

    async def subscribe(self, after_seq: int = 0) -> AsyncIterator[StreamEvent]:
        """依次产出 seq > after_seq 的事件；流关闭且读完后结束。"""
        position = max(after_seq, 0)
        while True:
            async with self._condition:
                await self._condition.wait_for(
                    lambda after=position: len(self._events) > after or self._closed
                )
                batch = self._events[position:]
                closed = self._closed
            for item in batch:
                yield item
            position += len(batch)
            if closed and position >= len(self._events):
                return


class EventBufferRegistry:
    def __init__(
        self, *, retention: float = 600.0, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._streams: dict[str, EventStream] = {}
        self._retention = retention
        self._clock = clock

    def create(self, stream_id: str, *, max_events: int = 100_000) -> EventStream:
        self.sweep()
        if stream_id in self._streams:
            raise KeyError(f"事件流 {stream_id} 已存在")
        stream = EventStream(stream_id, max_events=max_events, clock=self._clock)
        self._streams[stream_id] = stream
        return stream

    def get(self, stream_id: str) -> EventStream | None:
        self.sweep()
        return self._streams.get(stream_id)

    def sweep(self) -> int:
        """删除关闭已超过保留期的流，返回删除数量。"""
        now = self._clock()
        expired = [
            sid
            for sid, stream in self._streams.items()
            if stream.closed_at is not None and now - stream.closed_at > self._retention
        ]
        for sid in expired:
            del self._streams[sid]
        return len(expired)

    def __len__(self) -> int:
        return len(self._streams)
