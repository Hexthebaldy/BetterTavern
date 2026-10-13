from __future__ import annotations

import asyncio
import json

import pytest

from bettertavern.runtime.events.buffer import EventBufferRegistry, EventStream, StreamClosed

pytestmark = pytest.mark.anyio


async def collect(stream: EventStream, after: int = 0) -> list[int]:
    return [event.seq async for event in stream.subscribe(after)]


async def test_subscribers_see_all_events_and_end_on_close() -> None:
    stream = EventStream("t1")
    first = asyncio.create_task(collect(stream))
    await stream.publish("narrative.delta", {"text": "我"})
    await asyncio.sleep(0)
    late = asyncio.create_task(collect(stream))
    await stream.publish("narrative.delta", {"text": "推开门"})
    await stream.publish("turn.completed", {})
    await stream.close()
    assert await first == [1, 2, 3]
    assert await late == [1, 2, 3]  # 晚到的订阅者从头补齐


async def test_resume_after_seq() -> None:
    stream = EventStream("t1")
    for n in range(5):
        await stream.publish("narrative.delta", {"n": n})
    await stream.close()
    assert await collect(stream, after=3) == [4, 5]
    assert await collect(stream, after=99) == []


async def test_event_ids_and_json_payload() -> None:
    stream = EventStream("turn_9")
    event = await stream.publish("narrative.delta", {"text": "雨夜🌧️"})
    assert event.id == "turn_9:1"
    assert json.loads(event.data) == {"text": "雨夜🌧️"}
    assert "\\u" not in event.data  # 中文不转义，省流量


async def test_publish_after_close_and_overflow() -> None:
    stream = EventStream("t", max_events=1)
    await stream.publish("a", {})
    with pytest.raises(OverflowError):
        await stream.publish("b", {})
    await stream.close()
    with pytest.raises(StreamClosed):
        await stream.publish("c", {})


async def test_registry_retention() -> None:
    now = [0.0]
    registry = EventBufferRegistry(retention=600, clock=lambda: now[0])
    stream = registry.create("t1")
    registry.create("t2")
    with pytest.raises(KeyError):
        registry.create("t1")
    await stream.close()
    now[0] = 599
    assert registry.get("t1") is stream
    now[0] = 601
    assert registry.get("t1") is None
    assert registry.get("t2") is not None  # 未关闭的流不会过期
    assert len(registry) == 1
