from __future__ import annotations

import random

import pytest

from bettertavern.providers.sse_parser import SseDecoder, SseEvent, SseLineTooLong


def decode_all(chunks: list[bytes]) -> list[SseEvent]:
    decoder = SseDecoder()
    events: list[SseEvent] = []
    for piece in chunks:
        events += decoder.feed(piece)
    return events + decoder.flush()


def test_basic_events_and_fields() -> None:
    raw = b"event: delta\nid: t1:1\ndata: hello\n\ndata: a\ndata: b\nretry: 1500\n\n"
    events = decode_all([raw])
    assert events == [
        SseEvent(data="hello", event="delta", id="t1:1"),
        SseEvent(data="a\nb", retry=1500),
    ]


def test_value_keeps_inner_spaces_and_drops_one_leading_space() -> None:
    assert decode_all([b"data:  two spaces\n\n"]) == [SseEvent(data=" two spaces")]
    assert decode_all([b"data:no-space\n\n"]) == [SseEvent(data="no-space")]


def test_comments_are_counted_not_emitted() -> None:
    decoder = SseDecoder()
    events = decoder.feed(b": keep-alive\n\n: keepalive\n\ndata: x\n\n")
    assert events == [SseEvent(data="x")]
    assert decoder.comments == 2


def test_crlf_split_across_chunks_is_one_terminator() -> None:
    events = decode_all([b"data: one\r", b"\n\r", b"\ndata: two\r\n\r\n"])
    assert [e.data for e in events] == ["one", "two"]


def test_lone_cr_line_endings() -> None:
    assert [e.data for e in decode_all([b"data: x\r\rdata: y\r\r"])] == ["x", "y"]


def test_bom_is_stripped_only_at_start() -> None:
    events = decode_all([b"\xef\xbb\xbfdata: first\n\n"])
    assert events == [SseEvent(data="first")]


def test_event_without_trailing_blank_line_is_flushed() -> None:
    decoder = SseDecoder()
    assert decoder.feed(b"data: tail") == []
    assert decoder.flush() == [SseEvent(data="tail")]


def test_utf8_split_across_chunks() -> None:
    text = "雨夜的酒馆 🌧️ 𠮷"
    raw = f"data: {text}\n\n".encode()
    chunks = [raw[i : i + 1] for i in range(len(raw))]
    assert decode_all(chunks) == [SseEvent(data=text)]


def test_line_too_long_raises() -> None:
    decoder = SseDecoder(max_line_bytes=16)
    with pytest.raises(SseLineTooLong):
        decoder.feed(b"data: " + b"x" * 32)


def test_last_event_id_persists_across_events() -> None:
    decoder = SseDecoder()
    decoder.feed(b"id: s:1\ndata: a\n\ndata: b\n\n")
    assert decoder.last_event_id == "s:1"


@pytest.mark.parametrize("seed", range(20))
def test_any_chunking_gives_same_events(seed: int) -> None:
    rng = random.Random(seed)
    events = [
        SseEvent(data=f"第{i}段 ✨ chunk-{i}", event=rng.choice([None, "narrative.delta"]))
        for i in range(30)
    ]
    newline = rng.choice(["\n", "\r\n", "\r"])
    raw = bytearray()
    for event in events:
        if event.event:
            raw += f"event: {event.event}{newline}".encode()
        raw += f"data: {event.data}{newline}{newline}".encode()
    chunks: list[bytes] = []
    position = 0
    while position < len(raw):
        size = rng.randint(1, 17)
        chunks.append(bytes(raw[position : position + size]))
        position += size
    assert decode_all(chunks) == events
