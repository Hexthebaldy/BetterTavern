from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from bettertavern.api.sse import KEEPALIVE, encode_event, event_stream_body, parse_last_event_id
from bettertavern.providers.sse_parser import SseDecoder
from bettertavern.runtime.events.buffer import EventStream, StreamEvent

pytestmark = pytest.mark.anyio


def test_encode_event_round_trips_through_decoder() -> None:
    event = StreamEvent("t1", 3, "narrative.delta", '{"text": "第一行\\n第二行"}')
    decoded = SseDecoder().feed(encode_event(event))
    assert len(decoded) == 1
    assert decoded[0].id == "t1:3"
    assert decoded[0].event == "narrative.delta"
    assert decoded[0].data == event.data


def test_multiline_data_is_split_into_data_lines() -> None:
    event = StreamEvent("t1", 1, "x", "a\nb")
    assert encode_event(event) == b"id: t1:1\nevent: x\ndata: a\ndata: b\n\n"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("t1:5", 5),
        ("t1:0", 0),
        (None, 0),
        ("", 0),
        ("other:5", 0),
        ("t1:x", 0),
        ("5", 0),
    ],
)
def test_parse_last_event_id(value: str | None, expected: int) -> None:
    assert parse_last_event_id(value, "t1") == expected


def test_stream_ids_with_colons() -> None:
    assert parse_last_event_id("a:b:7", "a:b") == 7


async def test_body_sends_retry_events_and_keepalives() -> None:
    stream = EventStream("t1")
    chunks: list[bytes] = []

    async def produce() -> None:
        await stream.publish("narrative.delta", {"text": "我"})
        await asyncio.sleep(0.08)  # 期间应该发出 keepalive
        await stream.publish("turn.completed", {})
        await stream.close()

    async def consume(body: AsyncIterator[bytes]) -> None:
        async for chunk in body:
            chunks.append(chunk)

    producer = asyncio.create_task(produce())
    await consume(event_stream_body(stream.subscribe(), keepalive=0.02))
    await producer
    assert chunks[0] == b"retry: 1000\n\n"
    assert KEEPALIVE in chunks
    events = SseDecoder().feed(b"".join(chunks))
    assert [e.event for e in events] == ["narrative.delta", "turn.completed"]


async def test_body_closes_subscription_when_consumer_stops() -> None:
    stream = EventStream("t1")
    await stream.publish("a", {})
    body = event_stream_body(stream.subscribe(), keepalive=10)
    assert await anext(body) == b"retry: 1000\n\n"
    assert b"event: a" in await anext(body)
    await body.aclose()  # 客户端断开：不应挂住
